// Portal routes (specs/m2-scheduling-invites.md M2-11, R5-19, R5-24; ADR-030 amendment): GET /v1/portal/slots and
// POST /v1/portal/reschedule, Bearer `portal` token (1,800 s, minted after an OTP with purpose `manage`), the only
// routes that accept it; per-invitation InviteOtpDO buckets `portal_slots` and `portal_reschedule`. Availability is a
// boolean, never a count (E25, rule 5). Lead stub (Wave 1): app.ts mounts it; stream B4 adds the two routes here.
import type { Hono } from 'hono';
import type { EdgeEnv } from './http.js';
import type { RouteDeps } from './route-support.js';

/** Mounts the portal routes; the stub registers none yet (B4 adds the two routes and uses both arguments). */
export const mountPortalRoutes: (app: Hono<EdgeEnv>, deps: RouteDeps) => void = () => undefined;
