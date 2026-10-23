// The M1 routers of stream A2a as the lead mounts them in app.ts (spec m1 R2-18, R5-55 a, R5-56 f; AT-M1-24 api part):
// their method and path set is exactly the list the lead adds to route-inventory.test.ts, no path matches the
// never-build words, and a failed caller check answers the constant 401 on every route before any table, bucket,
// queue, limiter or library read.
import { noopErrorReporter } from '@trace/shared/log';
import { createHttpApp } from '@trace/workers-http';
import { describe, expect, it } from 'vitest';
import { createAiDraftsRoutes } from '../ai-drafts/routes.js';
import { createImportsRoutes } from '../imports/routes.js';
import { createLibraryRoutes } from '../library/routes.js';
import { createPoolsRoutes } from '../pools/routes.js';
import { orgFail, type OrgDeps } from '../tests/org-context.js';
import { createBankRoutes } from './routes.js';

const ORG = 'a1000000-0000-4000-8000-000000000001';
const ID = 'ee000000-0000-4000-8000-000000000001';
const SHA = 'ab'.repeat(32);

const touched: string[] = [];
const mount = (org: OrgDeps) => {
  const app = createHttpApp<{ Bindings: Env }>('api', {
    reporter: noopErrorReporter,
    sink: () => undefined,
  });
  const never = (name: string) => () => {
    touched.push(name);
    return null;
  };
  app.route('/', createBankRoutes({ org, variants: never('variants') }));
  app.route('/', createPoolsRoutes({ org }));
  app.route('/', createLibraryRoutes({ org, source: never('source'), limiter: never('limiter') }));
  app.route('/', createImportsRoutes({ org, media: never('media'), variants: never('variants') }));
  app.route('/', createAiDraftsRoutes({ org, queue: never('queue') }));
  return app;
};

/** The rows the lead adds to the route inventory (R2-18). */
export const A2A_NEW_ROUTES = [
  'GET /v1/orgs/:orgId/bank/items',
  'POST /v1/orgs/:orgId/bank/items',
  'GET /v1/orgs/:orgId/bank/items/:itemId',
  'PUT /v1/orgs/:orgId/bank/items/:itemId',
  'POST /v1/orgs/:orgId/bank/items/:itemId/versions',
  'POST /v1/orgs/:orgId/bank/item-versions/:versionId/submit',
  'POST /v1/orgs/:orgId/bank/item-versions/:versionId/review',
  'POST /v1/orgs/:orgId/bank/item-versions/:versionId/retire',
  'GET /v1/orgs/:orgId/bank/stats',
  'GET /v1/orgs/:orgId/pools',
  'POST /v1/orgs/:orgId/pools',
  'GET /v1/orgs/:orgId/pools/:poolId',
  'PUT /v1/orgs/:orgId/pools/:poolId',
  'POST /v1/orgs/:orgId/pools/:poolId/items',
  'DELETE /v1/orgs/:orgId/pools/:poolId/items',
  'GET /v1/orgs/:orgId/library/items',
  'POST /v1/orgs/:orgId/library/copy',
  'POST /v1/orgs/:orgId/imports',
  'GET /v1/orgs/:orgId/imports/:importId',
  'PUT /v1/orgs/:orgId/imports/:importId/images/:sha256',
  'POST /v1/orgs/:orgId/imports/:importId/rows',
  'POST /v1/orgs/:orgId/imports/:importId/complete',
  'POST /v1/orgs/:orgId/imports/:importId/cancel',
  'POST /v1/orgs/:orgId/bank/ai-drafts',
  'GET /v1/orgs/:orgId/bank/ai-drafts/:jobId',
];

describe('the A2a M1 routers', () => {
  it('expose exactly the listed paths and nothing matching the never-build words', () => {
    const app = mount({ context: async () => orgFail('unauthorized') });
    const own = [...new Set(app.routes.map((r) => `${r.method} ${r.path}`))].filter((r) =>
      r.includes('/v1/orgs/'),
    );
    expect(own.sort()).toEqual([...A2A_NEW_ROUTES].sort());
    for (const r of own) {
      expect(r).not.toMatch(
        /reject|decision|decide|confirm|overturn|appeal|notice|shortlist|emotion|gaze|likeness|solvab/i,
      );
    }
  });

  it('every route answers 401 unauthorized for a failed caller check, touching nothing', async () => {
    const app = mount({ context: async () => orgFail('unauthorized') });
    for (const route of A2A_NEW_ROUTES) {
      const [method = 'GET', template = ''] = route.split(' ');
      const path = template
        .replace(':orgId', ORG)
        .replace(/:(itemId|versionId|poolId|importId|jobId)/, ID)
        .replace(':sha256', SHA);
      const res = await app.request(
        `https://api.test${path}`,
        { method, ...(method === 'GET' ? {} : { body: '{}' }) },
        {} as Env,
      );
      expect(res.status, route).toBe(401);
      expect(await res.text()).toBe('{"error":{"code":"unauthorized"}}');
    }
    expect(touched).toEqual([]);
  });
});
