// AT-D13 (specs/d1-demo-slice.md §9, rules 2, 4, 6): the api serves exactly the D1 allow-list of
// method and path (§6.2: the three reports/:id GETs, /media/:jti, the org endpoints and /health)
// and no path or verb that could reject, decide, confirm, overturn, appeal, notify or shortlist.
// Parameter names are normalised to `:p`, so a renamed parameter is not a new route. Only the
// shared `*` middleware and the org CORS middleware (that one handler, by identity; security
// review N1, org-cors.test.ts) are left out; `/media/:jti` is registered for every method so that a
// non-GET gets the same 404 with the R3-6 headers, and the test below proves it serves only GET.
import { noopErrorReporter } from '@trace/shared/log';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { orgCors } from './org-cors.js';

const ALLOWED = [
  'GET /health',
  'GET /v1/orgs/:p/tests',
  'POST /v1/orgs/:p/tests',
  'GET /v1/orgs/:p/tests/:p',
  'PUT /v1/orgs/:p/tests/:p',
  'POST /v1/orgs/:p/tests/:p/publish',
  'GET /v1/orgs/:p/tests/:p/assignments',
  'POST /v1/orgs/:p/tests/:p/assignments',
  'DELETE /v1/orgs/:p/tests/:p/assignments/:p',
  'GET /v1/orgs/:p/tests/:p/invitations',
  'POST /v1/orgs/:p/tests/:p/invitations',
  'POST /v1/orgs/:p/tests/:p/invitations/:p/revoke',
  'GET /v1/orgs/:p/tests/:p/results',
  'GET /v1/orgs/:p/reports/:p',
  'GET /v1/orgs/:p/reports/:p/quality',
  'GET /v1/orgs/:p/reports/:p/integrity',
  'GET /v1/orgs/:p/review/reports',
  'POST /v1/orgs/:p/reports/:p/start-photo-link',
  'GET /v1/orgs/:p/demo-outbox',
  'ALL /media/:p',
  // M1 A2b (spec m1 R2-18; the list in modules/tests/m1-routes-mount.test.ts A2B_NEW_ROUTES).
  'PUT /v1/orgs/:p/tests/:p/draft',
  'POST /v1/orgs/:p/tests/:p/versions',
  'GET /v1/orgs/:p/tests/:p/integrity',
  'PUT /v1/orgs/:p/tests/:p/integrity',
  'GET /v1/orgs/:p/settings/integrity-locks',
  'POST /v1/orgs/:p/settings/integrity-locks',
  'DELETE /v1/orgs/:p/settings/integrity-locks/:p',
  'GET /v1/orgs/:p/templates',
  'POST /v1/orgs/:p/blueprints/propose',
  'POST /v1/orgs/:p/tests/from-template',
  'POST /v1/orgs/:p/members/invites',
  'GET /v1/orgs/:p/members/invites',
  'DELETE /v1/orgs/:p/members/invites/:p',
  // M1 A2a (spec m1 R2-18, R5-64 h; the list in modules/bank/m1-a2a-routes-mount.test.ts A2A_NEW_ROUTES).
  'GET /v1/orgs/:p/bank/items',
  'POST /v1/orgs/:p/bank/items',
  'GET /v1/orgs/:p/bank/items/:p',
  'PUT /v1/orgs/:p/bank/items/:p',
  'POST /v1/orgs/:p/bank/items/:p/versions',
  'POST /v1/orgs/:p/bank/item-versions/:p/submit',
  'POST /v1/orgs/:p/bank/item-versions/:p/review',
  'POST /v1/orgs/:p/bank/item-versions/:p/retire',
  'POST /v1/orgs/:p/bank/item-versions/:p/key-review',
  'GET /v1/orgs/:p/bank/stats',
  'GET /v1/orgs/:p/pools',
  'POST /v1/orgs/:p/pools',
  'GET /v1/orgs/:p/pools/:p',
  'PUT /v1/orgs/:p/pools/:p',
  'POST /v1/orgs/:p/pools/:p/items',
  'DELETE /v1/orgs/:p/pools/:p/items',
  'GET /v1/orgs/:p/library/items',
  'POST /v1/orgs/:p/library/copy',
  'POST /v1/orgs/:p/imports',
  'GET /v1/orgs/:p/imports/:p',
  'PUT /v1/orgs/:p/imports/:p/images/:p',
  'POST /v1/orgs/:p/imports/:p/rows',
  'POST /v1/orgs/:p/imports/:p/complete',
  'POST /v1/orgs/:p/imports/:p/cancel',
  'POST /v1/orgs/:p/bank/ai-drafts',
  'GET /v1/orgs/:p/bank/ai-drafts/:p',
].sort();

const FORBIDDEN = /reject|decision|decide|confirm|overturn|appeal|notice|shortlist/i;

const app = () => createApp({ reporter: noopErrorReporter });

/** Every route of the app as `METHOD /path`, the shared `*` and org CORS middleware left out. */
const routes = () =>
  [
    ...new Set(
      app()
        .routes.filter((r) => !(r.method === 'ALL' && (r.path === '*' || r.path === '/*')))
        .filter((r) => r.handler !== orgCors)
        .map((r) => `${r.method} ${r.path.replace(/:[A-Za-z_]\w*/g, ':p')}`),
    ),
  ].sort();

const ENV = { VERSION: 'dev', TRACE_ENV: 'dev' } as unknown as Env;

describe('api route inventory (AT-D13)', () => {
  it('serves exactly the D1 allow-list', () => {
    expect(routes()).toEqual(ALLOWED);
  });

  it('has no path or verb matching the forbidden words', () => {
    for (const r of app().routes) expect(`${r.method} ${r.path}`).not.toMatch(FORBIDDEN);
  });

  it('the forbidden pattern catches each word (guard self-test)', () => {
    for (const w of [
      'reject',
      'decision',
      'decide',
      'confirm',
      'overturn',
      'appeal',
      'notice',
      'shortlist',
    ])
      expect(`POST /v1/orgs/:p/reports/:p/${w}`).toMatch(FORBIDDEN);
  });

  it('/media/:jti answers every method but GET with the constant 404', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await app().fetch(
        new Request('https://api.test/media/00000000-0000-4000-8000-000000000001', { method }),
        ENV,
      );
      expect(res.status, method).toBe(404);
      expect(await res.json(), method).toStrictEqual({ error: { code: 'not_found' } });
    }
  });
});
