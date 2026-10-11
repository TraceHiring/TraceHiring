// Edge Worker app (spec §2, §9.3). M0a serves GET /health only.
// The edge Worker holds no secret, no database credential (spec §3 D6) and no error reporter
// (spec §9.2, Q17): it logs failures through the redacting logger and nothing else. It must never
// log request headers, IPs or bodies, so no request data is read below.
import { resolveVersion } from '@trace/shared';
import { healthBody } from '@trace/shared/health';
import { createLogger } from '@trace/shared/log';
import { Hono } from 'hono';

const SERVICE = 'edge';
const NO_STORE = { 'cache-control': 'no-store' } as const;

export interface AppDeps {
  /** The clock behind the health body's `time`. Tests inject their own. */
  now?: () => Date;
  /** Where log lines go. Defaults to the logger's own sink (console). Tests inject their own. */
  sink?: (line: string) => void;
}

/**
 * The version the error path labels its log line with. It never throws and falls back to 'dev',
 * because the error path must not fail on the same broken env that caused the error.
 */
const versionForErrorPath = (env: Env): string => {
  try {
    return resolveVersion(env.VERSION);
  } catch {
    return 'dev';
  }
};

/** The 500 answer that needs nothing from the request, the env or the logger. */
const staticInternalError = (): Response =>
  new Response('{"error":"internal"}', {
    status: 500,
    headers: { 'content-type': 'application/json', ...NO_STORE },
  });

export const createApp = (deps: AppDeps = {}): Hono<{ Bindings: Env }> => {
  const now = deps.now ?? (() => new Date());
  const app = new Hono<{ Bindings: Env }>();

  // Hono hands only Error instances to onError and rethrows anything else out of fetch, where the
  // runtime would answer with its own page and record the thrown value outside the redactor. So a
  // thrown string, null or object becomes an Error with a constant message first (S3A-1).
  app.use('*', async (_c, next) => {
    try {
      await next();
    } catch (thrown) {
      throw thrown instanceof Error ? thrown : new Error('non_error_thrown');
    }
  });

  app.get('/health', (c) =>
    c.json(healthBody(SERVICE, resolveVersion(c.env.VERSION), now()), 200, NO_STORE),
  );

  app.notFound((c) => c.json({ error: 'not_found' }, 404, NO_STORE));

  // The body carries no message and no stack (they can echo input); the log line carries the
  // serialised error (name, code, frames), never its message. If anything in here throws, the
  // static response below still goes out.
  app.onError((err, c) => {
    try {
      const log = createLogger({
        service: SERVICE,
        version: versionForErrorPath(c.env),
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
