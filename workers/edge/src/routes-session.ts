// Session routes (specs/d1-demo-slice.md §4.1 step 7-8, §4.2, §4.4; L-12, L-17, RT-11, RT-12).
//
// `session/start` (lobby token): the nonce and the 6/min limit in InviteOtpDO, then api `sessionGrant` (api re-checks
// the step order and mints the session token), the start photo head()-checked in R2, then `SessionDO.start` (the DO
// stamps `started_at` from its own clock), then api `sessionStarted` with claim-derived ids and the DO's `startedAt`
// (api sets `started` and the set-once `started_at`). A failed DO start changes nothing in Postgres; a retry re-grants
// and the DO answers its stored `startedAt`. Only when all of that succeeded is the lobby nonce cleared and the session
// token returned. A finished session answers its receipt instead of a token.
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
  readJson,
  sendJson,
  type EdgeContext,
  type EdgeEnv,
} from './http.js';
import { startPhotoKey } from './routes-photo.js';
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

/** The head()-checked start photo: the object must exist under the deterministic key with the declared sha256. */
const checkedPhoto = async (
  c: EdgeContext,
  orgId: string,
  sessionId: string,
  sha256: string,
): Promise<PhotoRef> => {
  const evidence = c.env.EVIDENCE;
  if (evidence === undefined) return fail('unavailable');
  const key = startPhotoKey(orgId, sessionId);
  let found: R2Object | null;
  try {
    found = await evidence.head(key);
  } catch {
    return fail('unavailable');
  }
  if (found === null) return fail('step_required');
  if (found.customMetadata?.sha256 !== sha256) return fail('bad_request');
  return { key, sha256, bytes: found.size };
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
      const photo =
        'sha256' in body.photo
          ? await checkedPhoto(c, claims.org_id, grant.sessionId, body.photo.sha256)
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
          photo,
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
      await rpc(c, deps, 'sessionStarted', {
        invitationId: claims.invitation_id,
        orgId: claims.org_id,
        sessionId: grant.sessionId,
        startedAt: started.startedAt,
      });
      const otp = otpFor(c, claims.invitation_id);
      await otpCall(() => otp.clearLobbyNonce());
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
