// Session routes (specs/d1-demo-slice.md §4.1 step 7-8, §4.2, §4.4; L-12, L-17, RT-11, RT-12).
//
// `session/start` (lobby token): the nonce and the 6/min limit in InviteOtpDO, then api `sessionGrant` (api re-checks
// the step order and mints the session token), InviteOtpDO `closePhotos` (no photo upload after this, SEC-1), the
// start photo read from the lobby's working key and verified byte for byte, then `SessionDO.start` (the DO stamps
// `started_at` from its own clock and stores the photo once), then the verified bytes pinned to the canonical
// `start_photo.jpg` (only if they are the photo the DO stored), then api `sessionStarted` with claim-derived ids and
// the DO's `startedAt` (api sets `started` and the set-once `started_at`). A failed DO start or pin changes nothing in
// Postgres; a retry re-grants and the DO answers its stored `startedAt`. Only when all of that succeeded is the lobby
// nonce cleared, the working copy removed and the session token returned. A finished session answers its receipt.
//
// `attach`, `items/:pos`, `events`, `submit` (session token): verified at the edge, then the invitation's SessionDO
// (the id from verified claims only) checks the token's nonce. Ids in the URL, query or body are never used.
import {
  EventBatchAck,
  EventBatchReq,
  Receipt,
  ServedItem,
  SessionAttachRes,
  SessionStartReq,
  SessionStartRes,
  SubmitReq,
  type CandidateTokenClaims,
} from '@trace/shared/contracts/candidate';
import type { Hono } from 'hono';
import {
  bearer,
  capBody,
  EVENTS_BODY_LIMIT,
  fail,
  failOutOfOrder,
  handle,
  LOBBY_BODY_LIMIT,
  PHOTO_BODY_LIMIT,
  readJson,
  sendJson,
  type EdgeContext,
  type EdgeEnv,
} from './http.js';
import { sha256HexBytes } from './encoding.js';
import {
  lobbyAuth,
  loggerFor,
  nowSec,
  otpCall,
  otpFor,
  rpc,
  sessionFor,
  type RouteDeps,
} from './route-support.js';
import type { PhotoRef, Refusal, SessionApi, SessionAuth } from './session-core.js';
import { verifyCandidateToken } from './token.js';

/** Answers a refusal of the SessionDO with its constant code (409 with `ackSeq`, 429 with `Retry-After`). */
const refuseSession = (result: Refusal): never => {
  if (result.error === 'out_of_order') return failOutOfOrder(result.ackSeq ?? 0);
  return fail(result.error, result.retryAfterSeconds);
};

interface SessionRequest {
  claims: CandidateTokenClaims;
  session: SessionApi;
  auth: SessionAuth;
}

/** Bearer, the token checks of §4.3 with typ `session`, then the invitation's SessionDO from the verified claims. */
const sessionAuth = async (c: EdgeContext, deps: RouteDeps): Promise<SessionRequest> => {
  const claims = await verifyCandidateToken(bearer(c), c.env, 'session', nowSec(deps));
  return {
    claims,
    session: sessionFor(c, claims.invitation_id),
    auth: { nonce: claims.nonce, orgId: claims.org_id },
  };
};

const POSITION = /^[1-9][0-9]{0,2}$/;

/**
 * The canonical R2 key of a session's start photo (§4.5): the key the session, the mirror, `media_objects` (its DB
 * guard) and the media link use. Only session start writes it, with bytes it verified. Ids come from api only.
 */
export const startPhotoKey = (orgId: string, sessionId: string): string =>
  `media/${orgId}/${sessionId}/start_photo.jpg`;

/** The working key the lobby upload route writes (a retake overwrites it); session start reads and then removes it. */
export const startPhotoUploadKey = (orgId: string, sessionId: string): string =>
  `media/${orgId}/${sessionId}/start_photo.upload.jpg`;

/** The start photo session start verified: its reference (canonical key) and, when read now, the bytes to pin. */
interface VerifiedPhoto {
  ref: PhotoRef;
  /** The verified bytes, or null when an earlier start already pinned them (a resume after the working copy went). */
  bytes: Uint8Array | null;
}

/**
 * Reads the working copy once and checks the bytes themselves: at most 512 000 bytes, and their sha256 equals both the
 * declared hash and the object's `customMetadata.sha256` (else 400). Missing → 403 `step_required`, unless a previous
 * start already pinned the declared photo under the canonical key. An R2 failure is 503.
 */
const verifiedPhoto = async (
  c: EdgeContext,
  orgId: string,
  sessionId: string,
  declared: string,
): Promise<VerifiedPhoto> => {
  const evidence = c.env.EVIDENCE;
  if (evidence === undefined) return fail('unavailable');
  const key = startPhotoKey(orgId, sessionId);
  let found: R2ObjectBody | null;
  let bytes: Uint8Array | null = null;
  try {
    found = await evidence.get(startPhotoUploadKey(orgId, sessionId));
    if (found !== null && found.size <= PHOTO_BODY_LIMIT) {
      bytes = new Uint8Array(await found.arrayBuffer());
    }
  } catch {
    return fail('unavailable');
  }
  if (found === null) {
    let pinned: R2Object | null;
    try {
      pinned = await evidence.head(key);
    } catch {
      return fail('unavailable');
    }
    if (pinned === null) return fail('step_required');
    if (pinned.customMetadata?.sha256 !== declared) return fail('bad_request');
    return { ref: { key, sha256: declared, bytes: pinned.size }, bytes: null };
  }
  if (bytes === null || bytes.length > PHOTO_BODY_LIMIT) return fail('bad_request');
  if (found.customMetadata?.sha256 !== declared || (await sha256HexBytes(bytes)) !== declared) {
    return fail('bad_request');
  }
  return { ref: { key, sha256: declared, bytes: bytes.length }, bytes };
};

/** Writes the verified bytes to the canonical key. Every writer writes identical bytes, so a repeat is harmless. */
const pinPhoto = async (c: EdgeContext, ref: PhotoRef, bytes: Uint8Array): Promise<void> => {
  const evidence = c.env.EVIDENCE;
  if (evidence === undefined) return fail('unavailable');
  try {
    await evidence.put(ref.key, bytes, {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { sha256: ref.sha256, blurred: '1' },
    });
  } catch {
    return fail('unavailable');
  }
};

/** Removes the working copy once the session holds its photo (one copy of the face photo, rule 8). Best effort. */
const dropWorkingPhoto = async (c: EdgeContext, orgId: string, sessionId: string) => {
  try {
    await c.env.EVIDENCE?.delete(startPhotoUploadKey(orgId, sessionId));
  } catch {
    // An orphan working copy lives under the session's media prefix and goes with it.
  }
};

export const mountSessionRoutes = (app: Hono<EdgeEnv>, deps: RouteDeps): void => {
  app.post(
    '/v1/session/start',
    capBody(LOBBY_BODY_LIMIT),
    handle(async (c) => {
      const { lobbyToken, claims } = await lobbyAuth(c, deps, 'start');
      const body = await readJson(c, SessionStartReq);
      const grant = await rpc(c, deps, 'sessionGrant', {
        lobbyToken,
        rulesAcknowledged: true,
        photo: body.photo,
      });
      // The token api minted must be a session token of this invitation carrying the grant's nonce.
      let granted: CandidateTokenClaims;
      try {
        granted = await verifyCandidateToken(grant.sessionToken, c.env, 'session', nowSec(deps));
      } catch {
        return fail('unavailable');
      }
      if (
        granted.invitation_id !== claims.invitation_id ||
        granted.org_id !== claims.org_id ||
        granted.candidate_id !== claims.candidate_id ||
        granted.nonce !== grant.nonce
      ) {
        return fail('unavailable');
      }
      // Close the photo step for good before the photo is read (C1a SEC-1): no upload can take a slot after this, so
      // the photo checked below is the session's. Only after a granted start (a refused grant must not lock uploads),
      // and on the skip path too. Set-once, so a retried start closes again harmlessly. If the close fails the start
      // fails closed (503, no SessionDO start) and the lobby token stays alive for a retry.
      const otp = otpFor(c, claims.invitation_id);
      await otpCall(() => otp.closePhotos());
      const photo =
        'sha256' in body.photo
          ? await verifiedPhoto(c, claims.org_id, grant.sessionId, body.photo.sha256)
          : null;
      const session = sessionFor(c, claims.invitation_id);
      const started = await otpCall(() =>
        session.start({
          sessionId: grant.sessionId,
          orgId: claims.org_id,
          invitationId: claims.invitation_id,
          testVersionId: grant.testVersionId,
          rulesetVersionId: grant.rulesetVersionId,
          consentId: grant.consentId,
          durationSeconds: grant.durationSeconds,
          grantStartedAt: grant.startedAt,
          packageKey: grant.packageKey,
          packageSha256: grant.packageSha256,
          nonce: grant.nonce,
          adultConfirmed: grant.adultConfirmed,
          photo: photo?.ref ?? null,
          photoSkippedReason: 'skippedReason' in body.photo ? body.photo.skippedReason : null,
        }),
      );
      if (!started.ok) {
        if (started.pkg !== undefined) {
          loggerFor(c, deps).error('session.package_invalid', {
            sessionId: grant.sessionId,
            pkg: started.pkg,
          });
        }
        return refuseSession(started);
      }
      // Pin the canonical photo only with the bytes whose hash the SessionDO stored (set once, at creation). A resume
      // that declares another photo (one that landed on the working key after the first start) writes nothing: the
      // session keeps its stored photo, which the first start pinned before it could answer a token. A failed pin is
      // 503 before sessionStarted; the retry resumes the DO and repeats the put.
      const verifiedBytes = photo?.bytes ?? null;
      if (photo !== null && verifiedBytes !== null && started.photoSha256 === photo.ref.sha256) {
        await pinPhoto(c, photo.ref, verifiedBytes);
      }
      await rpc(c, deps, 'sessionStarted', {
        invitationId: claims.invitation_id,
        orgId: claims.org_id,
        sessionId: grant.sessionId,
        startedAt: started.startedAt,
      });
      await otpCall(() => otp.clearLobbyNonce());
      // The working copy is never the session's photo once start succeeded: pinned, superseded by the stored photo, or
      // uploaded and then declined on the skip path (rule 8: no face photo kept after declining; re-review note 1).
      await dropWorkingPhoto(c, claims.org_id, grant.sessionId);
      if (started.kind === 'submitted') {
        return sendJson(c, SessionStartRes, { state: 'submitted', receipt: started.receipt });
      }
      return sendJson(c, SessionStartRes, {
        sessionToken: grant.sessionToken,
        expiresAt: new Date(granted.exp * 1000).toISOString(),
        view: started.view,
      });
    }),
  );

  app.post(
    '/v1/session/attach',
    capBody(LOBBY_BODY_LIMIT),
    handle(async (c) => {
      const { session, auth } = await sessionAuth(c, deps);
      const out = await otpCall(() => session.attach(auth));
      if (!out.ok) return refuseSession(out);
      return sendJson(c, SessionAttachRes, { view: out.view });
    }),
  );

  app.get(
    '/v1/session/items/:pos',
    handle(async (c) => {
      const { session, auth } = await sessionAuth(c, deps);
      const raw = c.req.param('pos') ?? '';
      if (!POSITION.test(raw)) return fail('bad_request');
      const out = await otpCall(() => session.item(auth, Number(raw)));
      if (!out.ok) return refuseSession(out);
      return sendJson(c, ServedItem, out.item);
    }),
  );

  app.post(
    '/v1/session/events',
    capBody(EVENTS_BODY_LIMIT),
    handle(async (c) => {
      const { session, auth } = await sessionAuth(c, deps);
      const batch = await readJson(c, EventBatchReq);
      const out = await otpCall(() => session.events(auth, batch));
      if (!out.ok) return refuseSession(out);
      return sendJson(c, EventBatchAck, {
        ackSeq: out.ackSeq,
        serverNow: out.serverNow,
        deadlineAt: out.deadlineAt,
        state: out.state,
      });
    }),
  );

  app.post(
    '/v1/session/submit',
    capBody(LOBBY_BODY_LIMIT),
    handle(async (c) => {
      const { session, auth } = await sessionAuth(c, deps);
      const request = await readJson(c, SubmitReq);
      const out = await otpCall(() => session.submit(auth, request));
      if (!out.ok) return refuseSession(out);
      return sendJson(c, Receipt, out.receipt);
    }),
  );
};
