// CORS for the org routes (specs/d1-demo-slice.md §6.2, §7.1 `ALLOWED_ORIGINS`; security review N1). The recruiter
// Pages origin calls `/v1/orgs/*` cross-origin with a Bearer `Authorization` header and no cookies, so the answer never
// carries Access-Control-Allow-Credentials. An Origin that exactly matches an ALLOWED_ORIGINS entry (the same parser as
// /media: trimmed, empty entries skipped, no wildcard, no pattern, never `null`) gets that origin in ACAO with
// `Vary: Origin` on every answer, the org errors and the shared 500 included. Any other Origin, or none, gets no CORS
// header and the request runs as before: CORS is not auth. A preflight from an allowed origin is answered here (204)
// before auth, the DB or a DO; from any other origin it stays the app's generic 404. /media keeps its own (R3-6).
// Nothing from the request is logged.
import type { MiddlewareHandler } from 'hono';
import { allowedOrigins } from './modules/media/routes.js';

/** Where app.ts mounts the middleware: the org routes only (not /health, /media or the candidate RPC). */
export const ORG_CORS_PATH = '/v1/orgs/*';
/** Every method the org routes register (org-cors.test.ts derives the set from the mounted routes). */
export const ORG_ALLOW_METHODS = 'GET, POST, PUT, DELETE';
/** What the recruiter client sends beyond the safelisted `accept` (apps/recruiter/src/api/client.ts `call`). */
export const ORG_ALLOW_HEADERS = 'authorization, content-type';
/** Seconds a browser may cache a preflight answer. */
export const ORG_PREFLIGHT_MAX_AGE = '600';

/** The request's Origin when it is on the allow-list, else null. Reads the env only when an Origin is sent. */
const allowedOrigin = (request: Request, env: Env | undefined): string | null => {
  const origin = request.headers.get('origin');
  if (origin === null) return null;
  return allowedOrigins(env?.ALLOWED_ORIGINS).includes(origin) ? origin : null;
};

/** One shared instance, so the route inventory can tell this middleware from a route (AT-D13). */
export const orgCors: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const origin = allowedOrigin(c.req.raw, c.env as Env | undefined);
  if (c.req.method === 'OPTIONS') {
    if (origin === null) return c.notFound();
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': ORG_ALLOW_METHODS,
        'access-control-allow-headers': ORG_ALLOW_HEADERS,
        'access-control-max-age': ORG_PREFLIGHT_MAX_AGE,
        'cache-control': 'no-store',
        vary: 'Origin',
      },
    });
  }
  await next();
  if (origin === null) return;
  // A copy, so a response with immutable headers can carry them too; the shared onError answer has already been set
  // as c.res when an org handler threw, so the 500 gets them as well.
  c.res = new Response(c.res.body, c.res);
  c.res.headers.set('access-control-allow-origin', origin);
  c.res.headers.append('vary', 'Origin');
};
