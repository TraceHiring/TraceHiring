// Portal routes (specs/m2-scheduling-invites.md M2-11, R5-19, R5-24, §6.6; ADR-030 amendment 1): GET /v1/portal/slots
// and POST /v1/portal/reschedule, Bearer `portal` token (1,800 s, minted after an OTP with purpose `manage`), the only
// routes that accept it (`portalAuth`; every other route asks the verifier for `lobby` or `session`, so a portal token
// is `token_invalid` there, and a lobby or session token is `token_invalid` here). Each checks the portal nonce and a
// per-invitation InviteOtpDO bucket (`portal_slots`, `portal_reschedule`); the ADR-032 link limiter covers only the
// three link-token routes and is not called here. api re-verifies the raw portal token. Availability is a boolean,
// never a count (E25, rule 5): the answers are checked against the strict contract and rebuilt field by field, so
// nothing api might add can reach the candidate. Ids in the body are discarded; the invitation comes from the claims.
import {
  PortalRescheduleReq,
  PortalRescheduleRes,
  PortalSlotsRes,
} from '@trace/shared/contracts/candidate';
import type { Hono } from 'hono';
import { capBody, handle, LOBBY_BODY_LIMIT, readJson, sendJson, type EdgeEnv } from './http.js';
import { portalAuth, rpc, type RouteDeps } from './route-support.js';

/** Mounts the two portal routes (app.ts mounts this under /v1/*, so noStore and candidateCors() apply). */
export const mountPortalRoutes: (app: Hono<EdgeEnv>, deps: RouteDeps) => void = (app, deps) => {
  app.get(
    '/v1/portal/slots',
    handle(async (c) => {
      const { portalToken } = await portalAuth(c, deps, 'portal_slots');
      const out = await rpc(c, deps, 'portalSlots', { portalToken });
      return sendJson(c, PortalSlotsRes, {
        slots: out.slots.map((slot) => ({
          slotId: slot.slotId,
          startsAt: slot.startsAt,
          available: slot.available,
        })),
      });
    }),
  );

  app.post(
    '/v1/portal/reschedule',
    capBody(LOBBY_BODY_LIMIT),
    handle(async (c) => {
      const { portalToken } = await portalAuth(c, deps, 'portal_reschedule');
      const { toSlotId } = await readJson(c, PortalRescheduleReq);
      const out = await rpc(c, deps, 'portalReschedule', { portalToken, toSlotId });
      return sendJson(c, PortalRescheduleRes, { ok: true, slotStartsAt: out.slotStartsAt });
    }),
  );
};
