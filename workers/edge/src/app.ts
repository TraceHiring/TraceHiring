// Edge Worker app (spec §2, §9.3). M0a serves GET /health only.
// The edge Worker holds no secret, no database credential (spec §3 D6) and no ErrorReporter
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

export const createApp = (deps: AppDeps = {}): Hono<{ Bindings: Env }> => {
  const now = deps.now ?? (() => new Date());
  const app = new Hono<{ Bindings: Env }>();

  app.get('/health', (c) =>
    c.json(healthBody(SERVICE, resolveVersion(c.env.VERSION), now()), 200, NO_STORE),
  );

  app.notFound((c) => c.json({ error: 'not_found' }, 404, NO_STORE));

  // The body carries no message and no stack (they can echo input); the log line carries the
  // serialised error (name, code, frames), never its message.
  app.onError((err, c) => {
    const log = createLogger({
      service: SERVICE,
      version: versionForErrorPath(c.env),
      ...(deps.sink === undefined ? {} : { sink: deps.sink }),
    });
    log.error('request.failed', undefined, { err });
    return c.json({ error: 'internal' }, 500, NO_STORE);
  });

  return app;
};
