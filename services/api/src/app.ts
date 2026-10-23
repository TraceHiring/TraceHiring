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
import { createAssignmentsRoutes } from './modules/assignments/routes.js';
import { createIntegritySettingsRoutes } from './modules/integrity-settings/routes.js';
import { createInvitationsRoutes, deliveryFromEnv } from './modules/invitations/routes.js';
import { createMediaRoutes, mediaFromEnv } from './modules/media/routes.js';
import { adminQueueFromEnv, createMembersRoutes, pepperFromEnv } from './modules/members/routes.js';
import { createOutboxRoutes, outboxReaderFromEnv } from './modules/outbox/routes.js';
import { createReportIntegrityRoutes } from './modules/report-integrity/routes.js';
import { createReportQualityRoutes } from './modules/report-quality/routes.js';
import { createReportsRoutes } from './modules/reports/routes.js';
import { referenceFromEnv } from './modules/templates/reference.js';
import { createTemplatesRoutes, type LibraryLimiter } from './modules/templates/routes.js';
import { createTestDraftRoutes } from './modules/tests/draft-routes.js';
import { cardSource, createOrgDeps, type OrgDeps } from './modules/tests/org-context.js';
import { createTestsRoutes, packagesFromEnv } from './modules/tests/routes.js';
import { ORG_CORS_PATH, orgCors } from './org-cors.js';

const SERVICE = 'api';

/** M1 R5-56 g: the per-user library limit (LIBRARY_LIMITER, 60 a minute), or null when unbound (the route answers 503). */
export const libraryLimiterFromEnv = (env: Env): LibraryLimiter | null =>
  env.LIBRARY_LIMITER ?? null;

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
  // createOrgDeps never calls fetch as a method (7734f06; spec review R3 reports, finding 1).
  const org = deps.org ?? createOrgDeps();
  const app = createHttpApp<{ Bindings: Env }>(SERVICE, deps);

  app.get('/health', (c) =>
    c.json(healthBody(SERVICE, resolveVersion(c.env.VERSION), now()), 200, NO_STORE),
  );

  // Security review N1: CORS for the recruiter origin on the org routes only, registered before them.
  app.use(ORG_CORS_PATH, orgCors);
  app.route(
    '/',
    createTestsRoutes({ org, packages: packagesFromEnv, reference: referenceFromEnv }),
  );
  // M1 A2b (spec m1 R2-18, R5-63): authoring drafts and versions, integrity settings, templates, member invites.
  app.route(
    '/',
    createTestDraftRoutes({ org, packages: packagesFromEnv, reference: referenceFromEnv }),
  );
  app.route('/', createIntegritySettingsRoutes({ org, reference: referenceFromEnv }));
  app.route(
    '/',
    createTemplatesRoutes({ org, reference: referenceFromEnv, limiter: libraryLimiterFromEnv }),
  );
  app.route('/', createMembersRoutes({ org, pepper: pepperFromEnv, queue: adminQueueFromEnv }));
  app.route('/', createAssignmentsRoutes(org));
  app.route('/', createInvitationsRoutes({ org, delivery: deliveryFromEnv }));
  app.route('/', createOutboxRoutes({ org, reader: outboxReaderFromEnv }));
  app.route('/', createMediaRoutes({ org, media: mediaFromEnv }));
  app.route('/', createReportsRoutes(org));
  app.route('/', createReportQualityRoutes(cardSource(org)));
  app.route('/', createReportIntegrityRoutes(cardSource(org)));

  return app;
};
