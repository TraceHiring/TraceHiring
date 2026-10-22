// The mount the lead adds to app.ts (writer report "app.ts diff"): the tests, assignments, invitations, outbox and
// media routers on the shared Workers app. Their method and path set is exactly the R3a part of the AT-D13 allow-list
// (the lead's route-inventory.test.ts owns the whole list), no path matches the never-build words, and an
// unauthenticated caller gets the constant 401 from every org route (the outbox route only where it exists).
import { noopErrorReporter } from '@trace/shared/log';
import { createHttpApp } from '@trace/workers-http';
import { describe, expect, it } from 'vitest';
import { createAssignmentsRoutes } from '../assignments/routes.js';
import { createInvitationsRoutes } from '../invitations/routes.js';
import { createMediaRoutes } from '../media/routes.js';
import { createOutboxRoutes } from '../outbox/routes.js';
import { orgFail, type OrgDeps } from './org-context.js';
import { createTestsRoutes } from './routes.js';

const ORG = 'a1000000-0000-4000-8000-000000000001';
const T = 'e1000000-0000-4000-8000-000000000001';
const X = 'f1000000-0000-4000-8000-000000000001';

const mount = (org: OrgDeps) => {
  const app = createHttpApp<{ Bindings: Env }>('api', {
    reporter: noopErrorReporter,
    sink: () => undefined,
  });
  app.route('/', createTestsRoutes({ org, packages: () => null }));
  app.route('/', createAssignmentsRoutes(org));
  app.route('/', createInvitationsRoutes({ org, delivery: () => null }));
  app.route('/', createOutboxRoutes({ org, reader: () => null }));
  app.route('/', createMediaRoutes({ org, media: async () => null }));
  return app;
};

const EXPECTED = [
  'GET /v1/orgs/:orgId/tests',
  'POST /v1/orgs/:orgId/tests',
  'GET /v1/orgs/:orgId/tests/:testId',
  'PUT /v1/orgs/:orgId/tests/:testId',
  'POST /v1/orgs/:orgId/tests/:testId/publish',
  'GET /v1/orgs/:orgId/tests/:testId/assignments',
  'POST /v1/orgs/:orgId/tests/:testId/assignments',
  'DELETE /v1/orgs/:orgId/tests/:testId/assignments/:assignmentId',
  'GET /v1/orgs/:orgId/tests/:testId/invitations',
  'POST /v1/orgs/:orgId/tests/:testId/invitations',
  'POST /v1/orgs/:orgId/tests/:testId/invitations/:invitationId/revoke',
  'GET /v1/orgs/:orgId/demo-outbox',
  'POST /v1/orgs/:orgId/reports/:reportId/start-photo-link',
  'ALL /media/:jti',
];

describe('the R3a org routers mounted on the api app', () => {
  it('expose exactly the R3a allow-list paths and nothing matching the never-build words', () => {
    const app = mount({ context: async () => orgFail('unauthorized') });
    const own = app.routes
      .map((r) => `${r.method} ${r.path}`)
      .filter((r) => r.includes('/v1/orgs/') || r.includes('/media/'));
    expect([...new Set(own)].sort()).toEqual([...EXPECTED].sort());
    for (const r of own) {
      expect(r).not.toMatch(
        /reject|decision|decide|confirm|overturn|appeal|notice|shortlist|cutoff/,
      );
    }
  });

  it('every org route answers 401 unauthorized for a failed caller check', async () => {
    const app = mount({ context: async () => orgFail('unauthorized') });
    const env = { TRACE_ENV: 'staging', DEMO_OUTBOX: '1' } as unknown as Env;
    for (const [method, path] of [
      ['GET', `/v1/orgs/${ORG}/tests`],
      ['POST', `/v1/orgs/${ORG}/tests`],
      ['GET', `/v1/orgs/${ORG}/tests/${T}`],
      ['PUT', `/v1/orgs/${ORG}/tests/${T}`],
      ['POST', `/v1/orgs/${ORG}/tests/${T}/publish`],
      ['GET', `/v1/orgs/${ORG}/tests/${T}/assignments`],
      ['POST', `/v1/orgs/${ORG}/tests/${T}/assignments`],
      ['DELETE', `/v1/orgs/${ORG}/tests/${T}/assignments/${X}`],
      ['GET', `/v1/orgs/${ORG}/tests/${T}/invitations`],
      ['POST', `/v1/orgs/${ORG}/tests/${T}/invitations`],
      ['POST', `/v1/orgs/${ORG}/tests/${T}/invitations/${X}/revoke`],
      ['GET', `/v1/orgs/${ORG}/demo-outbox`],
      ['POST', `/v1/orgs/${ORG}/reports/${X}/start-photo-link`],
    ] as const) {
      const res = await app.request(
        `https://api.test${path}`,
        { method, ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }) },
        env,
      );
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(await res.text()).toBe('{"error":{"code":"unauthorized"}}');
    }
  });

  it('the media fetch is the generic 404 when unbound, and an unknown org path is the app 404', async () => {
    const app = mount({ context: async () => orgFail('unauthorized') });
    const media = await app.request(`https://api.test/media/${X}?exp=1&sig=x`, {}, {} as Env);
    expect(media.status).toBe(404);
    const other = await app.request(
      `https://api.test/v1/orgs/${ORG}/tests/${T}/cutoff`,
      {},
      {} as Env,
    );
    expect(other.status).toBe(404);
  });
});
