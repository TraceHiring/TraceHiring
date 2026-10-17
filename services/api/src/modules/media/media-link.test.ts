// AT-D10 (api half, spec §9; §6.2 R3-1..R3-9): the start-photo link is issued only after media_link_grant committed,
// expires in exactly 300 s, is single use, carries an HMAC over `v1|jti|exp`, and every failure is the same 404
// with the R3-6 headers. The grant functions are modelled in media.test-helpers.ts; the database side is
// supabase/tests/rls_d1_media_view.test.sql (lead).
import { MediaLinkResponse } from '@trace/shared/contracts/d1';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { OrgContext } from '../tests/org-context.js';
import { LINK_TTL_SECONDS, importHmacKey, signLink, type MediaDeps } from './media-link.js';
import {
  KEY,
  MEDIA,
  ORG,
  ORG_B,
  REPORT,
  VIEWER,
  caller,
  fakeEvidence,
  fakeLinks,
  fakeMediaDb,
  fakeRest,
  mediaTables,
  orgDeps,
} from './media.test-helpers.js';
import { registerMediaRoutes } from './routes.js';

const T0 = Date.parse('2026-10-17T08:00:00.000Z');
const RECRUITER_ORIGIN = 'https://trace-recruiter-staging.pages.dev';
const ENV = { ALLOWED_ORIGINS: RECRUITER_ORIGIN } as unknown as Env;

const setup = async (
  opts: { tables?: ReturnType<typeof mediaTables>; ctx?: Partial<OrgContext> } = {},
) => {
  const clock = { now: T0 };
  const db = fakeMediaDb({ now: () => clock.now });
  const links = fakeLinks();
  const evidence = fakeEvidence();
  const hmacKey = await importHmacKey('k'.repeat(16) + crypto.randomUUID());
  let n = 0;
  const deps: MediaDeps = {
    db: db.db,
    links,
    evidence,
    hmacKey,
    now: () => clock.now,
    newId: () => {
      n += 1;
      return `9a000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    },
  };
  const rest = fakeRest(opts.tables ?? mediaTables());
  const context: OrgContext = { caller: caller(), rest, ...opts.ctx };
  const app = new Hono<{ Bindings: Env }>();
  let closed = 0;
  registerMediaRoutes(app, {
    org: orgDeps(context),
    media: async () => ({
      deps,
      close: async () => {
        closed += 1;
      },
    }),
  });
  const issue = (orgId = ORG, reportId = REPORT) =>
    app.request(
      `https://api.test/v1/orgs/${orgId}/reports/${reportId}/start-photo-link`,
      { method: 'POST' },
      ENV,
    );
  const fetchLink = (url: string, init: RequestInit = {}) =>
    app.request(url, { headers: { origin: RECRUITER_ORIGIN }, ...init }, ENV);
  return {
    clock,
    db,
    links,
    evidence,
    deps,
    rest,
    app,
    issue,
    fetchLink,
    hmacKey,
    closed: () => closed,
  };
};

const issuedUrl = async (res: Response) => MediaLinkResponse.parse(await res.json()).url;

describe('POST …/start-photo-link', () => {
  it('writes media.link_issued for the viewer, then returns a 300 s link with the watermark', async () => {
    const s = await setup();
    const res = await s.issue();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = MediaLinkResponse.parse(await res.json());
    expect(body.watermark).toEqual({
      viewerRole: 'reviewer',
      org: 'Synthetic Org A',
      issuedAt: new Date(T0).toISOString(),
    });
    const url = new URL(body.url);
    expect(url.origin).toBe('https://api.test');
    expect(url.pathname).toMatch(/^\/media\/[0-9a-f-]{36}$/);
    expect(Number(url.searchParams.get('exp'))).toBe(Math.floor(T0 / 1000) + LINK_TTL_SECONDS);
    expect(Date.parse(body.expiresAt) - T0).toBe(300_000);
    expect(s.db.audit).toEqual([
      expect.objectContaining({ action: 'media.link_issued', mediaId: MEDIA, actor: VIEWER }),
    ]);
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(s.closed()).toBe(1);
  });

  it('refuses a viewer without an assignment, of every role, with 404 and no link', async () => {
    for (const roles of [['org_owner'], ['admin'], ['recruiter'], ['reviewer']]) {
      const tables = mediaTables();
      tables.memberships = [{ org_id: ORG, user_id: VIEWER, status: 'active', roles }];
      const s = await setup({ tables });
      s.db.allowed.clear();
      const res = await s.issue();
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: { code: 'not_found' } });
      expect(s.db.audit).toEqual([]);
      expect(s.links.calls).not.toContain('issue');
    }
  });

  it('filters by the path org (R3-8): a report of another org is a 404', async () => {
    const s = await setup();
    expect((await s.issue(ORG_B)).status).toBe(404);
    expect(s.db.audit).toEqual([]);
  });

  it('answers 404 for an unknown report, a report without a photo and a malformed id', async () => {
    const tables = mediaTables();
    tables.media_objects = [];
    const s = await setup({ tables });
    expect((await s.issue()).status).toBe(404);
    expect((await s.issue(ORG, 'd1000000-0000-4000-8000-000000000099')).status).toBe(404);
    expect((await s.issue(ORG, 'not-a-uuid')).status).toBe(404);
  });

  it('a failed COMMIT of the grant gives no link', async () => {
    const s = await setup();
    s.db.state.failCommit = true;
    expect((await s.issue()).status).toBe(404);
    expect(s.links.calls).not.toContain('issue');
  });

  it('rate-limits link issues per viewer (R3-7)', async () => {
    const s = await setup();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) statuses.push((await s.issue()).status);
    expect(statuses.slice(0, 20).every((x) => x === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describe('GET /media/:jti', () => {
  it('streams the photo once with the R3-6 headers and writes one media.view', async () => {
    const s = await setup();
    const url = await issuedUrl(await s.issue());
    const res = await s.fetchLink(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(res.headers.get('access-control-allow-origin')).toBe(RECRUITER_ORIGIN);
    expect(res.headers.get('vary')).toBe('Origin');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer()).slice(0, 3)).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff]),
    );
    expect(s.db.audit.map((r) => r.action)).toEqual(['media.link_issued', 'media.view']);
  });

  it('a replay is 404, never reaches Postgres and writes no second media.view (R3-9)', async () => {
    const s = await setup();
    const url = await issuedUrl(await s.issue());
    expect((await s.fetchLink(url)).status).toBe(200);
    const dbCalls = s.db.state.dbCalls;
    const again = await s.fetchLink(url);
    expect(again.status).toBe(404);
    expect(again.headers.get('cache-control')).toBe('no-store');
    expect(again.headers.get('access-control-allow-origin')).toBe(RECRUITER_ORIGIN);
    expect(s.db.state.dbCalls).toBe(dbCalls);
    expect(s.db.audit.filter((r) => r.action === 'media.view')).toHaveLength(1);
  });

  it('concurrent fetches of one link: exactly one 200', async () => {
    const s = await setup();
    const url = await issuedUrl(await s.issue());
    const results = await Promise.all(Array.from({ length: 25 }, () => s.fetchLink(url)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((x) => x === 200)).toHaveLength(1);
    expect(statuses.filter((x) => x === 404)).toHaveLength(24);
    expect(s.db.audit.filter((r) => r.action === 'media.view')).toHaveLength(1);
  });

  it('an expired link is 404 before any DO or DB call, and writes no row', async () => {
    const s = await setup();
    const url = await issuedUrl(await s.issue());
    s.clock.now = T0 + 301_000;
    const calls = s.links.calls.length;
    const dbCalls = s.db.state.dbCalls;
    expect((await s.fetchLink(url)).status).toBe(404);
    expect(s.links.calls.length).toBe(calls);
    expect(s.db.state.dbCalls).toBe(dbCalls);
    expect(s.db.audit.filter((r) => r.action === 'media.view')).toEqual([]);
  });

  it('a tampered sig or exp, or an exp beyond 300 s, is 404 before the DO (no burn)', async () => {
    const s = await setup();
    const url = new URL(await issuedUrl(await s.issue()));
    const sig = url.searchParams.get('sig') ?? '';
    const tampered = new URL(url);
    tampered.searchParams.set('sig', `${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`);
    const shifted = new URL(url);
    shifted.searchParams.set('exp', String(Number(url.searchParams.get('exp')) - 1));
    const jti = url.pathname.split('/').pop() ?? '';
    const far = Math.floor(T0 / 1000) + 301;
    const long = new URL(
      `https://api.test/media/${jti}?exp=${far}&sig=${await signLink(s.hmacKey, jti, far)}`,
    );
    for (const u of [tampered, shifted, long])
      expect((await s.fetchLink(u.toString())).status).toBe(404);
    expect(s.links.calls.filter((c) => c === 'burn')).toEqual([]);
    expect((await s.fetchLink(url.toString())).status).toBe(200);
  });

  it('a DB denial at fetch (viewer lost access) gives no bytes and burns the link', async () => {
    const s = await setup();
    const url = await issuedUrl(await s.issue());
    s.db.allowed.clear();
    expect((await s.fetchLink(url)).status).toBe(404);
    expect(s.evidence.reads).toEqual([]);
    s.db.allowed.add(`${MEDIA}|${VIEWER}`);
    expect((await s.fetchLink(url)).status).toBe(404);
  });

  it('an injected COMMIT failure at fetch gives no bytes', async () => {
    const s = await setup();
    const url = await issuedUrl(await s.issue());
    s.db.state.failCommit = true;
    expect((await s.fetchLink(url)).status).toBe(404);
    expect(s.evidence.reads).toEqual([]);
  });

  it('every method but GET is the generic 404 and never burns', async () => {
    const s = await setup();
    const url = await issuedUrl(await s.issue());
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
      const res = await s.fetchLink(url, { method });
      expect(res.status).toBe(404);
    }
    expect(s.links.calls.filter((c) => c === 'burn')).toEqual([]);
    expect((await s.fetchLink(url)).status).toBe(200);
  });

  it('gives no ACAO to an origin outside ALLOWED_ORIGINS', async () => {
    const s = await setup();
    const url = await issuedUrl(await s.issue());
    const res = await s.app.request(url, { headers: { origin: 'https://evil.test' } }, ENV);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
