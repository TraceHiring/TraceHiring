// API service app (spec §2, §9.3; d1 §6.2). GET /health plus the D1 org modules, each a sub-router built from its
// own deps and mounted here (ADR-027 modular monolith). Errors reach the injected ErrorReporter only through
// reportError, which serialises and redacts them (spec §9.2). No request data (headers, IPs, bodies) is read or
// logged here. The error and 404 handling is shared with the other Workers in @trace/workers-http.
//
// Rule 1 (d1 §6.2, L-19): this composition root wires both card modules; each card module gets only the structural
// `CardSource`, never the neutral org context, and neither imports the other.
import { resolveVersion } from '@trace/shared';
import { healthBody } from '@trace/shared/health';
import { type ErrorReporter } from '@trace/shared/log';
import { createHttpApp, NO_STORE } from '@trace/workers-http';
import type { Hono } from 'hono';
import { createReportIntegrityRoutes } from './modules/report-integrity/routes.js';
import { createReportQualityRoutes } from './modules/report-quality/routes.js';
import { createReportsRoutes } from './modules/reports/routes.js';
import { cardSource, createOrgDeps, type OrgDeps } from './modules/tests/org-context.js';

const SERVICE = 'api';

export interface AppDeps {
  /** Where errors go. M0a injects noopErrorReporter; the Sentry adapter replaces it before D1. */
  reporter: ErrorReporter;
  /** The clock behind the health body's `time`. Tests inject their own. */
  now?: () => Date;
  /** Where log lines go. Defaults to the logger's own sink (console). Tests inject their own. */
  sink?: (line: string) => void;
  /** Caller verification and PostgREST as the caller for every org route. Defaults to createOrgDeps(). */
  org?: OrgDeps;
}

export const createApp = (deps: AppDeps): Hono<{ Bindings: Env }> => {
  const now = deps.now ?? (() => new Date());
  // The global fetch is wrapped, never passed bare: org-context calls it as `opts.fetch(...)`, and a host method
  // called with another `this` throws "Illegal invocation" in workerd (spec review R3 reports, finding 1).
  const org = deps.org ?? createOrgDeps((input, init) => fetch(input, init));
  const app = createHttpApp<{ Bindings: Env }>(SERVICE, deps);

  app.get('/health', (c) =>
    c.json(healthBody(SERVICE, resolveVersion(c.env.VERSION), now()), 200, NO_STORE),
  );

  app.route('/', createReportsRoutes(org));
  app.route('/', createReportQualityRoutes(cardSource(org)));
  app.route('/', createReportIntegrityRoutes(cardSource(org)));

  return app;
};
