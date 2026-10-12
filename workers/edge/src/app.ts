// Edge Worker app (spec §2, §9.3). M0a serves GET /health only.
// The edge Worker holds no secret, no database credential (spec §3 D6) and no error reporter
// (spec §9.2, Q17): it logs failures through the redacting logger and nothing else. It must never
// log request headers, IPs or bodies, so no request data is read below. The error and 404 handling
// is shared with the other Workers in @trace/workers-http and is given no reporter here.
import { resolveVersion } from '@trace/shared';
import { healthBody } from '@trace/shared/health';
import { createHttpApp, NO_STORE } from '@trace/workers-http';
import type { Hono } from 'hono';

const SERVICE = 'edge';

export interface AppDeps {
  /** The clock behind the health body's `time`. Tests inject their own. */
  now?: () => Date;
  /** Where log lines go. Defaults to the logger's own sink (console). Tests inject their own. */
  sink?: (line: string) => void;
}

export const createApp = (deps: AppDeps = {}): Hono<{ Bindings: Env }> => {
  const now = deps.now ?? (() => new Date());
  const app = createHttpApp<{ Bindings: Env }>(SERVICE, deps);

  app.get('/health', (c) =>
    c.json(healthBody(SERVICE, resolveVersion(c.env.VERSION), now()), 200, NO_STORE),
  );

  return app;
};
