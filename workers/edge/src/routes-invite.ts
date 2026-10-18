// Link and OTP routes (specs/d1-demo-slice.md §4.1 steps 1-2, §4.2): no Bearer, the raw link token in the body.
// `resolve` is read only and sends nothing. `otp/request` issues a code in the invitation's InviteOtpDO and hands it to
// api `messagingSend`, which resolves the address itself (the edge never sees one). `otp/verify` checks the code in
// the object, which rotates the lobby nonce, then api `lobbyMint` puts that nonce in the lobby token. The invitation
// id and org come from api's link-token lookup, never from the request. An inviter's under-18 answer stops the flow
// before any OTP exists (rule 9, RT-8).
import {
  InviteResolveReq,
  InviteResolveRes,
  OtpRequestReq,
  OtpRequestRes,
  OtpVerifyReq,
  OtpVerifyRes,
  type InvitationState,
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
import { loggerFor, otpCall, otpFor, refuse, rpc, type RouteDeps } from './route-support.js';

/** States in which no code may be sent or verified: the link is dead or the candidate is not eligible. */
const refuseState = (state: InvitationState): void => {
  if (state === 'blocked_age') fail('not_eligible');
  if (state === 'expired') fail('link_expired');
  if (state === 'revoked') fail('link_revoked');
};

const resolveLink = async (c: EdgeContext, deps: RouteDeps, token: string) => {
  const found = await rpc(c, deps, 'inviteResolve', { token });
  refuseState(found.state);
  return found;
};

export const mountInviteRoutes = (app: Hono<EdgeEnv>, deps: RouteDeps): void => {
  app.post(
    '/v1/invite/resolve',
    capBody(LOBBY_BODY_LIMIT),
    handle(async (c) => {
      const { token } = await readJson(c, InviteResolveReq);
      const found = await rpc(c, deps, 'inviteResolve', { token });
      // Only the state and display data go back: no id, org or candidate key (rule 5).
      return sendJson(c, InviteResolveRes, {
        state: found.state,
        ...(found.title === undefined ? {} : { title: found.title }),
        ...(found.durationMinutes === undefined ? {} : { durationMinutes: found.durationMinutes }),
      });
    }),
  );

  app.post(
    '/v1/otp/request',
    capBody(LOBBY_BODY_LIMIT),
    handle(async (c) => {
      const { token } = await readJson(c, OtpRequestReq);
      const found = await resolveLink(c, deps, token);
      const otp = otpFor(c, found.invitationId);
      const issued = await otpCall(() => otp.issue());
      if (!issued.ok) return refuse(issued);
      try {
        await rpc(c, deps, 'messagingSend', {
          invitationId: found.invitationId,
          orgId: found.orgId,
          code: issued.code,
          idempotencyKey: issued.challengeId,
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
      const found = await resolveLink(c, deps, token);
      const otp = otpFor(c, found.invitationId);
      const verified = await otpCall(() => otp.verify(code));
      if (!verified.ok) {
        // Logged once, by the attempt that creates the lock; refusals during the lock log nothing (SR-7).
        if ('lockedNow' in verified && verified.lockedNow) {
          loggerFor(c, deps).warn('otp.locked', { invitationId: found.invitationId });
        }
        return refuse(verified);
      }
      const minted = await rpc(c, deps, 'lobbyMint', {
        invitationId: found.invitationId,
        orgId: found.orgId,
        nonce: verified.nonce,
      });
      return sendJson(c, OtpVerifyRes, minted);
    }),
  );
};
