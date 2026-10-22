// Jobs Worker app (spec §2, §9.3). M0a serves GET /health only; no queue or cron binding exists yet.
// Errors reach the injected ErrorReporter only through reportError, which serialises and redacts
// them (spec §9.2). No request data (headers, IPs, bodies) is read or logged here. The error and
// 404 handling is shared with the other Workers in @trace/workers-http.
import { resolveVersion } from '@trace/shared';
import { healthBody } from '@trace/shared/health';
import { type ErrorReporter } from '@trace/shared/log';
import { createHttpApp, NO_STORE } from '@trace/workers-http';
import type { Hono } from 'hono';

const SERVICE = 'jobs';

export interface AppDeps {
  /** Where errors go. M0a injects noopErrorReporter; the Sentry adapter replaces it before D1. */
  reporter: ErrorReporter;
  /** The clock behind the health body's `time`. Tests inject their own. */
  now?: () => Date;
  /** Where log lines go. Defaults to the logger's own sink (console). Tests inject their own. */
  sink?: (line: string) => void;
}

export const createApp = (deps: AppDeps): Hono<{ Bindings: Env }> => {
  const now = deps.now ?? (() => new Date());
  const app = createHttpApp<{ Bindings: Env }>(SERVICE, deps);

  app.get('/health', (c) =>
    c.json(healthBody(SERVICE, resolveVersion(c.env.VERSION), now()), 200, NO_STORE),
  );

  return app;
};
