// The mount the lead adds to app.ts (report §"app.ts diff"): the three report routers on the shared Workers app, the
// card modules fed by `cardSource(orgDeps)` (type-checked here: the shared CardSource fits both structural sources).
// An unauthenticated caller gets 401 from every route, a PostgREST denial becomes 404, and the two card routes and
// the metadata route never shadow each other.
import { noopErrorReporter } from '@trace/shared/log';
import { createHttpApp } from '@trace/workers-http';
import { describe, expect, it } from 'vitest';
import { createReportIntegrityRoutes } from '../report-integrity/routes.js';
import { createReportQualityRoutes } from '../report-quality/routes.js';
import { cardSource, OrgError, RestError, type OrgDeps } from '../tests/org-context.js';
import {
  baseTables,
  candidateRows,
  ENV,
  fakeDeps,
  merge,
  ORG,
  reportId,
  TEST,
} from './reports.test-helpers.js';
import { createReportsRoutes } from './routes.js';

const mount = (deps: OrgDeps) => {
  const app = createHttpApp<{ Bindings: Env }>('api', {
    reporter: noopErrorReporter,
    sink: () => undefined,
  });
  app.route('/', createReportsRoutes(deps));
  app.route('/', createReportQualityRoutes(cardSource(deps)));
  app.route('/', createReportIntegrityRoutes(cardSource(deps)));
  return app;
};

const paths = [
  `/v1/orgs/${ORG}/tests/${TEST}/results`,
  `/v1/orgs/${ORG}/reports/${reportId(1)}`,
  `/v1/orgs/${ORG}/reports/${reportId(1)}/quality`,
  `/v1/orgs/${ORG}/reports/${reportId(1)}/integrity`,
  `/v1/orgs/${ORG}/review/reports`,
];

describe('the report routers mounted on the api app', () => {
  it('route each path to its own module', async () => {
    const { deps } = fakeDeps(
      merge(baseTables(), candidateRows({ n: 1, score: 72, integrity: 'reviewed' })),
    );
    const app = mount(deps);
    const bodies = await Promise.all(
      paths.map(async (p) => {
        const res = await app.request(`http://api.test${p}`, {}, ENV);
        expect(res.status, p).toBe(200);
        return (await res.json()) as Record<string, unknown>;
      }),
    );
    expect(Object.keys(bodies[0] ?? {})).toEqual(['cutoff', 'rows']);
    expect(Object.keys(bodies[1] ?? {})).toEqual(['report', 'versions']);
    expect(bodies[2]?.state).toBe('ready');
    expect(bodies[2]).toHaveProperty('score');
    expect(bodies[3]).toHaveProperty('band');
    expect(Object.keys(bodies[4] ?? {})).toEqual(['reports']);
  });

  it('an unauthenticated caller gets 401 everywhere; a PostgREST denial is 404', async () => {
    const unauth: OrgDeps = { context: () => Promise.reject(new OrgError('unauthorized')) };
    const denied: OrgDeps = {
      context: () =>
        Promise.resolve({
          caller: {
            userId: '0f000000-0000-4000-8000-000000000001',
            aal: 'aal2',
            amr: [],
            jwt: 'h.p.s',
          },
          rest: {
            select: () => Promise.reject(new RestError(403, '42501')),
            insert: () => Promise.reject(new Error('no')),
            update: () => Promise.reject(new Error('no')),
            remove: () => Promise.reject(new Error('no')),
          },
        }),
    };
    for (const p of paths) {
      const a = await mount(unauth).request(`http://api.test${p}`, {}, ENV);
      expect(a.status, p).toBe(401);
      expect(await a.json()).toStrictEqual({ error: { code: 'unauthorized' } });
      const d = await mount(denied).request(`http://api.test${p}`, {}, ENV);
      expect(d.status, p).toBe(404);
      expect(await d.json()).toStrictEqual({ error: { code: 'not_found' } });
    }
  });
});
