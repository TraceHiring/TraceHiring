// Link and OTP routes (specs/d1-demo-slice.md §4.1 steps 1-2, §4.2): no Bearer, the raw link token in the body.
// `resolve` is read only and sends nothing. `otp/request` issues a code in the invitation's InviteOtpDO and hands it to
// api `messagingSend`, which resolves the address itself (the edge never sees one). `otp/verify` checks the code in
// the object, which rotates the nonce, then api mints a token on that nonce. The invitation id and org come from api's
// link-token lookup, never from the request. An inviter's under-18 answer stops the flow before any OTP exists (rule 9,
// RT-8). Each route checks the coarse link limit (OPEN-13, link-limit.ts) after the strict parse and before its first
// api call.
//
// M2 (specs/m2-scheduling-invites.md R5-19, R5-23, R5-53, R5-64, R5-66 c):
// - `resolve` copies api's `schedule` field by field (null or absent for D1 rows) and adds nothing.
// - `otp/request` takes an optional `purpose` (`lobby` when absent, so the D1 app keeps working), binds it to the
//   challenge at issue and passes it to `messagingSend` (the manage email copy). `otp/verify` mints by the purpose the
//   object stored: `lobby` → api `lobbyMint` → `OtpVerifyRes`; `manage` → api `portalMint` → `OtpVerifyPortalRes`.
// - A drive row before its start (api answers a `schedule`) gets a read-only `SessionDO.peek()` first, and api gets
//   `sessionLive`. When api's own phase says the lobby is not open and the object holds no session, purpose `lobby` is
//   refused (409 `lobby_closed`) before a code is issued (so no send budget is used) and at verify before the code is
//   compared (nothing consumed); api applies the same refusal at send and at mint, and its answer wins. A started row
//   has no `schedule` (R5-64 b): api alone decides it (`session_grant_exp`, R5-53). D1 rows keep the D1 path exactly.
import {
  InviteResolveReq,
  InviteResolveRes,
  OtpRequestReq,
  OtpRequestRes,
  OtpVerifyPortalRes,
  OtpVerifyReq,
  OtpVerifyRes,
  type CandidateSchedule,
  type InvitationState,
  type OtpPurpose,
} from '@trace/shared/contracts/candidate';
import type { Hono } from 'hono';
import {
  capBody,
  fail,
  handle,
  isEdgeError,
  LOBBY_BODY_LIMIT,
  readJson,
  sendJson,
  type EdgeContext,
  type EdgeEnv,
} from './http.js';
import { createLinkLimit } from './link-limit.js';
import {
  loggerFor,
  otpCall,
  otpFor,
  refuse,
  rpc,
  sessionLive,
  type RouteDeps,
} from './route-support.js';
import type { RpcOut } from './rpc.js';

/** States in which no code may be sent or verified: the link is dead or the candidate is not eligible. */
const refuseState = (state: InvitationState): void => {
  if (state === 'blocked_age') fail('not_eligible');
  if (state === 'expired') fail('link_expired');
  if (state === 'revoked') fail('link_revoked');
};

type Resolved = RpcOut<'inviteResolve'>;

const resolveLink = async (c: EdgeContext, deps: RouteDeps, token: string) => {
  const found = await rpc(c, deps, 'inviteResolve', { token });
  refuseState(found.state);
  return found;
};

/** The schedule api answered, copied field by field (R5-23): only the contract's fields ever leave the edge. */
const copySchedule = (schedule: CandidateSchedule): CandidateSchedule => ({
  mode: schedule.mode,
  phase: schedule.phase,
  ...(schedule.slotStartsAt === undefined ? {} : { slotStartsAt: schedule.slotStartsAt }),
  ...(schedule.lobbyOpensAt === undefined ? {} : { lobbyOpensAt: schedule.lobbyOpensAt }),
  ...(schedule.startWindowEndsAt === undefined
    ? {}
    : { startWindowEndsAt: schedule.startWindowEndsAt }),
  ...(schedule.deadlineAt === undefined ? {} : { deadlineAt: schedule.deadlineAt }),
});

/**
 * Where a drive row before its start stands (R5-66 c): `sessionLive` from the invitation's SessionDO, and whether
 * purpose `lobby` is closed by api's own phase (anything but `lobby_open`) for a row whose object holds no session.
 * A row without a schedule (a D1 row, or a started or finished drive row) needs neither: `{}`.
 */
const driveGate = async (
  c: EdgeContext,
  found: Resolved,
): Promise<{ sessionLive?: boolean; lobbyClosed: boolean }> => {
  const schedule = found.schedule;
  if (schedule === undefined || schedule === null) return { lobbyClosed: false };
  const live = await sessionLive(c, found.invitationId);
  return { sessionLive: live, lobbyClosed: !live && schedule.phase !== 'lobby_open' };
};

export const mountInviteRoutes = (app: Hono<EdgeEnv>, deps: RouteDeps): void => {
  const linkLimit = createLinkLimit(deps);

  app.post(
    '/v1/invite/resolve',
    capBody(LOBBY_BODY_LIMIT),
    handle(async (c) => {
      const { token } = await readJson(c, InviteResolveReq);
      await linkLimit(c, 'resolve');
      const found = await rpc(c, deps, 'inviteResolve', { token });
      // Only the state and display data go back: no id, org or candidate key (rule 5).
      return sendJson(c, InviteResolveRes, {
        state: found.state,
        ...(found.title === undefined ? {} : { title: found.title }),
        ...(found.durationMinutes === undefined ? {} : { durationMinutes: found.durationMinutes }),
        ...(found.schedule === undefined
          ? {}
          : { schedule: found.schedule === null ? null : copySchedule(found.schedule) }),
      });
    }),
  );

  app.post(
    '/v1/otp/request',
    capBody(LOBBY_BODY_LIMIT),
    handle(async (c) => {
      const body = await readJson(c, OtpRequestReq);
      const purpose: OtpPurpose = body.purpose ?? 'lobby';
      await linkLimit(c, 'otp_request');
      const found = await resolveLink(c, deps, body.token);
      const gate = await driveGate(c, found);
      if (purpose === 'lobby' && gate.lobbyClosed) return fail('lobby_closed');
      const otp = otpFor(c, found.invitationId);
      const issued = await otpCall(() => otp.issue(purpose));
      if (!issued.ok) return refuse(issued);
      try {
        await rpc(c, deps, 'messagingSend', {
          invitationId: found.invitationId,
          orgId: found.orgId,
          code: issued.code,
          idempotencyKey: issued.challengeId,
          purpose,
          ...(gate.sessionLive === undefined ? {} : { sessionLive: gate.sessionLive }),
        });
      } catch (err) {
        // The code was not sent: give the send back so the candidate is not locked out of the resend budget (SR-2).
        // Only on `unavailable`; any other code keeps the send used. A failed release still answers the send's error.
        if (isEdgeError(err) && err.code === 'unavailable') {
          try {
            await otp.releaseIssue(issued.challengeId);
          } catch {
            // keep the send's answer
          }
        }
        throw err;
      }
      return sendJson(c, OtpRequestRes, {
        resendAfterSeconds: issued.resendAfterSeconds,
        expiresInSeconds: issued.expiresInSeconds,
        channel: 'email',
      });
    }),
  );

  app.post(
    '/v1/otp/verify',
    capBody(LOBBY_BODY_LIMIT),
    handle(async (c) => {
      const { token, code } = await readJson(c, OtpVerifyReq);
      await linkLimit(c, 'otp_verify');
      const found = await resolveLink(c, deps, token);
      const gate = await driveGate(c, found);
      const otp = otpFor(c, found.invitationId);
      // The purpose is the one stored at issue (R5-19); with the lobby closed only a manage code may verify.
      const allowed: readonly OtpPurpose[] | undefined = gate.lobbyClosed ? ['manage'] : undefined;
      const verified = await otpCall(() => otp.verify(code, allowed));
      if (!verified.ok) {
        // Logged once, by the attempt that creates the lock; refusals during the lock log nothing (SR-7).
        if ('lockedNow' in verified && verified.lockedNow) {
          loggerFor(c, deps).warn('otp.locked', { invitationId: found.invitationId });
        }
        return refuse(verified);
      }
      if (verified.purpose === 'manage') {
        // A manage code mints a portal token only, never a lobby token (AT-M2-34).
        const portal = await rpc(c, deps, 'portalMint', {
          invitationId: found.invitationId,
          orgId: found.orgId,
          nonce: verified.nonce,
        });
        return sendJson(c, OtpVerifyPortalRes, portal);
      }
      const minted = await rpc(c, deps, 'lobbyMint', {
        invitationId: found.invitationId,
        orgId: found.orgId,
        nonce: verified.nonce,
        ...(gate.sessionLive === undefined ? {} : { sessionLive: gate.sessionLive }),
      });
      return sendJson(c, OtpVerifyRes, minted);
    }),
  );
};
