// @trace/workers-http: the HTTP error and 404 handling shared by the three Workers (edge, jobs,
// api). Workers only (specs/m0b-tenancy.md §1.1 item 9b): the ESLint boundaries let workers/* and
// services/api import it, and nothing else. It adds no dependency (Hono is already a Worker
// dependency, ADR-028).
//
// A Worker builds its app with createHttpApp and then adds its routes. Nothing here reads request
// data (headers, IPs, bodies, URLs), so nothing of it can reach a log line, a report or a response.
import { resolveVersion } from '@trace/shared';
import { createLogger, reportError, type ErrorReporter } from '@trace/shared/log';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

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

/**
 * What the error path may be given. Both are read when an error happens, inside the handler's
 * try, so a deps object whose getter throws still ends in the static 500.
 */
export interface ErrorHandlingDeps {
  /**
   * Where errors go, through reportError (serialised, then redacted). Absent on the edge Worker,
   * which has no error reporter (M0a spec §9.2, build-notes Q17): it only logs.
   */
  readonly reporter?: ErrorReporter;
  /** Where log lines go. Defaults to the logger's own sink (console). Tests inject their own. */
  readonly sink?: ((line: string) => void) | undefined;
}

/**
 * The version the error path labels its log line and its report with. It never throws and falls
 * back to 'dev', because the error path must not fail on the same broken env that caused the error.
 */
const versionForErrorPath = (env: { VERSION: string }): string => {
  try {
    return resolveVersion(env.VERSION);
  } catch {
    return 'dev';
  }
};

/**
 * A copy of a 4xx HTTPException's response: same status and body, headers without `set-cookie`,
 * and `cache-control: no-store` over whatever it set.
 */
const clientErrorAnswer = (err: HTTPException): Response => {
  const original = err.getResponse();
  const headers = new Headers(original.headers);
  headers.delete('set-cookie');
  headers.set('cache-control', NO_STORE['cache-control']);
  return new Response(original.body, { status: err.status, headers });
};

/**
 * A Hono app with the Workers' shared error handling already installed. Add routes to the result;
 * the handling is registered first, so it wraps every route added afterwards.
 *
 * - A thrown string, null or object becomes `new Error('non_error_thrown')` first. Hono hands only
 *   Error instances to onError and rethrows anything else out of fetch, where the runtime would
 *   answer with its own page and record the thrown value outside the redactor (S3A-1).
 * - A Hono `HTTPException` with a status from 400 to 499 is answered with a copy of its
 *   `getResponse()`: the same status and body, its headers except `set-cookie` (dropped), and
 *   `cache-control: no-store` forced over any value it set. It is an answer the code chose, not a
 *   failure, so it is neither logged nor reported. Its message goes to the client as is, so it must
 *   be a constant, never text built from input. Hono's `validator('form')` builds its message from
 *   parser errors, so do not use it without a custom hook.
 * - An `HTTPException` with any other status (5xx, or outside 400-499) is a failure: it takes the
 *   path below, so it is reported once and logged once, and the client gets the constant 500, never
 *   the exception's own message or body.
 * - Any other error (and such an `HTTPException`) is logged once as `request.failed` through the redacting logger (the serialised
 *   error, never its message) and, when a reporter is given, reported first with the release. The
 *   body is `{"error":"internal"}` with status 500 and `cache-control: no-store`: no message, no
 *   stack. If anything in the handler throws, the static 500 still goes out.
 * - An unknown route answers `{"error":"not_found"}` with status 404 and `cache-control: no-store`.
 *
 * `service` labels the log lines. `deps` is read at error time (see ErrorHandlingDeps).
 */
export const createHttpApp = <E extends { Bindings: { VERSION: string } }>(
  service: string,
  deps: ErrorHandlingDeps = {},
): Hono<E> => {
  const app = new Hono<E>();

  app.use('*', async (_c, next) => {
    try {
      await next();
    } catch (thrown) {
      throw thrown instanceof Error ? thrown : new Error('non_error_thrown');
    }
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404, NO_STORE));

  app.onError((err, c) => {
    try {
      if (err instanceof HTTPException && err.status >= 400 && err.status <= 499) {
        return clientErrorAnswer(err);
      }
      const release = versionForErrorPath(c.env);
      if (deps.reporter !== undefined) reportError(deps.reporter, err, { release });
      const log = createLogger({
        service,
        version: release,
        ...(deps.sink === undefined ? {} : { sink: deps.sink }),
      });
      log.error('request.failed', undefined, { err });
      return c.json({ error: 'internal' }, 500, NO_STORE);
    } catch {
      return staticInternalError();
    }
  });

  return app;
};
