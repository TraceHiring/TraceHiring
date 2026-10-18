// Edge Worker app (spec §2, §9.3; specs/d1-demo-slice.md §4.2). GET /health plus the candidate routes under /v1.
// The edge Worker holds no secret, no database credential (spec §3 D6) and no error reporter
// (spec §9.2, Q17): it logs failures through the redacting logger and nothing else. It must never
// log request headers, IPs or bodies. The error and 404 handling is shared with the other Workers in
// @trace/workers-http and is given no reporter here.
import { resolveVersion } from '@trace/shared';
import { healthBody } from '@trace/shared/health';
import { createHttpApp, NO_STORE } from '@trace/workers-http';
import type { Hono } from 'hono';
import { candidateCors, noStore } from './http.js';
import type { RouteDeps } from './route-support.js';
import { mountInviteRoutes } from './routes-invite.js';
import { mountLobbyRoutes } from './routes-lobby.js';
import { mountPhotoRoute } from './routes-photo.js';

const SERVICE = 'edge';

export interface AppDeps {
  /** The clock behind the health body's `time` and the token checks. Tests inject their own. */
  now?: () => Date;
  /** Where log lines go. Defaults to the logger's own sink (console). Tests inject their own. */
  sink?: (line: string) => void;
}

export const createApp = (deps: AppDeps = {}): Hono<{ Bindings: Env }> => {
  const now = deps.now ?? (() => new Date());
  // Only the sink is handed on, never the whole deps object, so nothing else (a reporter passed
  // through a cast) can reach the shared error path. The getter reads the sink at error time.
  const app = createHttpApp<{ Bindings: Env }>(SERVICE, {
    get sink() {
      return deps.sink;
    },
  });

  app.get('/health', (c) =>
    c.json(healthBody(SERVICE, resolveVersion(c.env.VERSION), now()), 200, NO_STORE),
  );

  // Every candidate answer is never cached and is CORS-limited to the candidate app (§4.2).
  app.use('/v1/*', noStore, candidateCors());
  const routeDeps: RouteDeps = {
    now,
    get sink() {
      return deps.sink;
    },
  };
  mountInviteRoutes(app, routeDeps);
  mountLobbyRoutes(app, routeDeps);
  mountPhotoRoute(app, routeDeps);

  return app;
};
