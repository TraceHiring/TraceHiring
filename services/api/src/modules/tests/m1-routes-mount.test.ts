// The M1 routers of stream A2b as the lead mounts them in app.ts (spec m1 R2-18, R5-53 c; AT-M1-24 api part): their
// method and path set is exactly the list the lead adds to route-inventory.test.ts (including the two DELETE paths), no
// path matches the never-build words, and a failed caller check answers the constant 401 on every route before any
// table is read.
import { noopErrorReporter } from '@trace/shared/log';
import { createHttpApp } from '@trace/workers-http';
import { describe, expect, it } from 'vitest';
import { createIntegritySettingsRoutes } from '../integrity-settings/routes.js';
import { createMembersRoutes } from '../members/routes.js';
import { createTemplatesRoutes } from '../templates/routes.js';
import { createTestDraftRoutes } from './draft-routes.js';
import { orgFail, type OrgDeps } from './org-context.js';

const ORG = 'a1000000-0000-4000-8000-000000000001';
const T = 'e1000000-0000-4000-8000-000000000001';
const I = 'ee000000-0000-4000-8000-000000000001';

const mount = (org: OrgDeps) => {
  const app = createHttpApp<{ Bindings: Env }>('api', {
    reporter: noopErrorReporter,
    sink: () => undefined,
  });
  app.route('/', createTestDraftRoutes({ org, packages: () => null }));
  app.route('/', createIntegritySettingsRoutes({ org, reference: () => null }));
  app.route('/', createTemplatesRoutes({ org, reference: () => null, limiter: () => null }));
  app.route('/', createMembersRoutes({ org, pepper: () => null, queue: () => null }));
  return app;
};

/** The rows the lead adds to the route inventory (R2-18). */
export const A2B_NEW_ROUTES = [
  'PUT /v1/orgs/:orgId/tests/:testId/draft',
  'POST /v1/orgs/:orgId/tests/:testId/versions',
  'GET /v1/orgs/:orgId/tests/:testId/integrity',
  'PUT /v1/orgs/:orgId/tests/:testId/integrity',
  'GET /v1/orgs/:orgId/settings/integrity-locks',
  'POST /v1/orgs/:orgId/settings/integrity-locks',
  'DELETE /v1/orgs/:orgId/settings/integrity-locks/:settingKey',
  'GET /v1/orgs/:orgId/templates',
  'POST /v1/orgs/:orgId/blueprints/propose',
  'POST /v1/orgs/:orgId/tests/from-template',
  'POST /v1/orgs/:orgId/members/invites',
  'GET /v1/orgs/:orgId/members/invites',
  'DELETE /v1/orgs/:orgId/members/invites/:inviteId',
];

describe('the A2b M1 routers', () => {
  it('expose exactly the listed paths and nothing matching the never-build words', () => {
    const app = mount({ context: async () => orgFail('unauthorized') });
    const own = [...new Set(app.routes.map((r) => `${r.method} ${r.path}`))].filter((r) =>
      r.includes('/v1/orgs/'),
    );
    expect(own.sort()).toEqual([...A2B_NEW_ROUTES].sort());
    for (const r of own) {
      expect(r).not.toMatch(/reject|decision|decide|confirm|overturn|appeal|notice|shortlist/i);
    }
  });

  it('every route answers 401 unauthorized for a failed caller check', async () => {
    const app = mount({ context: async () => orgFail('unauthorized') });
    for (const route of A2B_NEW_ROUTES) {
      const [method = 'GET', template = ''] = route.split(' ');
      const path = template
        .replace(':orgId', ORG)
        .replace(':testId', T)
        .replace(':settingKey', 'paste_written')
        .replace(':inviteId', I);
      const res = await app.request(
        `https://api.test${path}`,
        { method, ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }) },
        {} as Env,
      );
      expect(res.status, route).toBe(401);
      expect(await res.text()).toBe('{"error":{"code":"unauthorized"}}');
    }
  });
});
