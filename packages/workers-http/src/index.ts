// @trace/workers-http: HTTP error and 404 handling shared by the three Workers (edge, jobs, api).
// Workers only (specs/m0b-tenancy.md §1.1 item 9b): the ESLint boundaries let workers/* and
// services/api import it, and nothing else. It adds no dependency (Hono is already a Worker
// dependency, ADR-028). Stream B5 moves the rest of each Worker's app.ts error handling here.

/** The only cache header the Workers send on their JSON answers. */
export const NO_STORE: Readonly<{ 'cache-control': 'no-store' }> = Object.freeze({
  'cache-control': 'no-store',
});

/** The 500 answer that needs nothing from the request, the env or the logger. */
export const staticInternalError = (): Response =>
  new Response('{"error":"internal"}', {
    status: 500,
    headers: { 'content-type': 'application/json', ...NO_STORE },
  });
