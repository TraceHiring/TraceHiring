// AT-M2-22, edge part (specs/m2-scheduling-invites.md R5-37; CLAUDE.md rules 2, 4, 6): the edge serves exactly this
// list of method and path, the two M2 portal routes included, and no route path or verb that could reject, decide,
// confirm, overturn, appeal, notify or shortlist. The one exception is D1's `GET /v1/lobby/notice` (the candidate's
// privacy notice before consent), pinned exactly so no other path can use the word. Parameter names are normalised
// to `:p`; the `/v1/*` middleware (noStore, candidateCors) and the shared `*` handlers are left out.
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const ALLOWED = [
  'GET /health',
  'POST /v1/invite/resolve',
  'POST /v1/otp/request',
  'POST /v1/otp/verify',
  'POST /v1/lobby/age',
  'GET /v1/lobby/notice',
  'POST /v1/lobby/consent',
  'PUT /v1/lobby/photo',
  'POST /v1/session/start',
  'POST /v1/session/attach',
  'GET /v1/session/items/:p',
  'POST /v1/session/events',
  'POST /v1/session/submit',
  'GET /v1/session/media/:p',
  // M2 R5-24: the portal routes (Bearer `portal` only).
  'GET /v1/portal/slots',
  'POST /v1/portal/reschedule',
].sort();

const FORBIDDEN = /reject|decision|decide|confirm|overturn|appeal|notice|shortlist/i;
/** D1's privacy-notice read before consent: the only route allowed to match FORBIDDEN (by `notice`). */
const NOTICE_EXCEPTION = 'GET /v1/lobby/notice';

const MIDDLEWARE = new Set(['*', '/*', '/v1/*']);

/** Every route of the app as `METHOD /path`, the middleware left out. */
const routes = () =>
  [
    ...new Set(
      createApp()
        .routes.filter((r) => !(r.method === 'ALL' && MIDDLEWARE.has(r.path)))
        .map((r) => `${r.method} ${r.path.replace(/:[A-Za-z_]\w*/g, ':p')}`),
    ),
  ].sort();

describe('edge route inventory (AT-M2-22, R5-37)', () => {
  it('serves exactly the allow-list, the two portal routes included', () => {
    expect(routes()).toEqual(ALLOWED);
  });

  it('no route path or verb matches the forbidden words, except the pinned lobby notice read', () => {
    const matching = createApp()
      .routes.map((r) => `${r.method} ${r.path}`)
      .filter((route) => FORBIDDEN.test(route));
    expect([...new Set(matching)]).toEqual([NOTICE_EXCEPTION]);
  });

  it('the portal routes carry no forbidden word', () => {
    for (const route of ALLOWED.filter((r) => r.includes('/v1/portal/'))) {
      expect(route).not.toMatch(FORBIDDEN);
    }
  });

  it('the forbidden pattern catches each word (guard self-test), so the exception list cannot hide one', () => {
    for (const w of [
      'reject',
      'decision',
      'decide',
      'confirm',
      'overturn',
      'appeal',
      'notice',
      'shortlist',
    ]) {
      expect(`POST /v1/portal/${w}`).toMatch(FORBIDDEN);
      expect(`POST /v1/portal/${w}`).not.toBe(NOTICE_EXCEPTION);
    }
  });

  it('the only middleware left out is the /v1/* noStore + CORS pair and the shared handlers', () => {
    const left = createApp()
      .routes.filter((r) => r.method === 'ALL')
      .map((r) => r.path);
    for (const path of left) expect(MIDDLEWARE.has(path)).toBe(true);
  });
});
