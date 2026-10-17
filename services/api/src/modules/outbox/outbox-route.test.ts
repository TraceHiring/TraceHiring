// AT-D18 (api half) and spec §6.2 `GET /v1/orgs/:orgId/demo-outbox`: 404 on production, with TRACE_ENV missing or
// empty, or with the switch off, before the token is even read; on dev/staging owner, admin and recruiter of the
// path org read that org's entries only (newest first, no address); everyone else gets 404.
import { OutboxListResponse } from '@trace/shared/contracts/d1';
import { describe, expect, it } from 'vitest';
import { OrgError, type OrgCaller } from '../tests/org-context.js';
import { fakeDb } from '../tests/rest.test-helpers.js';
import { createDemoOutbox } from './outbox-writer.js';
import { fakeOutboxNamespace } from './outbox.test-helpers.js';
import { createOutboxRoutes } from './routes.js';

const ORG = 'a1000000-0000-4000-8000-000000000001';
const ORG_B = 'a1000000-0000-4000-8000-000000000003';
const USER = '00000000-0000-4000-8000-000000000005';
const STAGING = { TRACE_ENV: 'staging', DEMO_OUTBOX: '1' };

const setup = (
  opts: { roles?: string[]; org?: string; caller?: Partial<OrgCaller>; reader?: boolean } = {},
) => {
  const ns = fakeOutboxNamespace();
  const outbox = createDemoOutbox(STAGING, ns);
  if (outbox === null) throw new Error('outbox');
  const db = fakeDb({
    memberships: [
      {
        id: 'd1000000-0000-4000-8000-000000000005',
        org_id: opts.org ?? ORG,
        user_id: USER,
        roles: opts.roles ?? ['recruiter'],
        status: 'active',
      },
    ],
  });
  let contextCalls = 0;
  const listed: string[] = [];
  const app = createOutboxRoutes({
    org: {
      context: async () => {
        contextCalls += 1;
        return {
          caller: { userId: USER, aal: 'aal1', amr: ['otp'], jwt: 'h.p.s', ...opts.caller },
          rest: db.rest,
        };
      },
    },
    reader: () =>
      opts.reader === false
        ? null
        : {
            list: async (orgId) => {
              listed.push(orgId);
              return outbox.list(orgId);
            },
          },
  });
  const get = (env: Record<string, unknown>, org = ORG) =>
    app.request(`https://api.test/v1/orgs/${org}/demo-outbox`, {}, env as unknown as Env);
  return { outbox, get, listed, calls: () => contextCalls };
};

const message = (n: number, kind: 'invite' | 'otp') => ({
  kind,
  to: `cand0${String(n)}@example.test`,
  candidateLabel: `Candidate ${String(n)}`,
  bodyText: `Synthetic ${kind} body ${String(n)}`,
  idempotencyKey: `${kind}:${String(n)}`,
});

describe('GET /v1/orgs/:orgId/demo-outbox', () => {
  it('is 404 on production, without TRACE_ENV, with it empty or unknown, or with the switch off, before auth', async () => {
    const s = setup();
    for (const env of [
      { TRACE_ENV: 'production', DEMO_OUTBOX: '1' },
      { DEMO_OUTBOX: '1' },
      { TRACE_ENV: '', DEMO_OUTBOX: '1' },
      { TRACE_ENV: 'preview', DEMO_OUTBOX: '1' },
      { TRACE_ENV: 'staging', DEMO_OUTBOX: '0' },
      { TRACE_ENV: 'staging' },
    ]) {
      const res = await s.get(env);
      expect(res.status, JSON.stringify(env)).toBe(404);
      expect(await res.text()).toBe('{"error":{"code":"not_found"}}');
    }
    expect(s.calls()).toBe(0);
    expect(s.listed).toEqual([]);
  });

  it('on staging a recruiter of the path org reads its entries newest first, with no address', async () => {
    const s = setup();
    await s.outbox.write(ORG, message(1, 'invite'));
    await s.outbox.write(ORG, message(1, 'otp'));
    await s.outbox.write(ORG_B, message(2, 'invite'));
    const res = await s.get(STAGING);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(text).not.toContain('@');
    const body = OutboxListResponse.parse(JSON.parse(text));
    expect(body.entries.map((e) => [e.kind, e.candidateLabel])).toEqual([
      ['otp', 'Candidate 1'],
      ['invite', 'Candidate 1'],
    ]);
    expect(s.listed).toEqual([ORG]);
  });

  it('owner and admin at aal2 read it too', async () => {
    for (const roles of [['org_owner', 'admin'], ['admin']]) {
      const s = setup({ roles, caller: { aal: 'aal2', amr: ['password', 'totp'] } });
      expect((await s.get({ TRACE_ENV: 'dev', DEMO_OUTBOX: '1' })).status).toBe(200);
    }
  });

  it('a reviewer, a hiring manager and a member of another org are 404; the DO is never read', async () => {
    for (const opts of [
      { roles: ['reviewer'], caller: { aal: 'aal2' as const } },
      { roles: ['hiring_manager'] },
      { org: ORG_B },
    ]) {
      const s = setup(opts);
      const res = await s.get(STAGING);
      expect(res.status).toBe(404);
      expect(s.listed).toEqual([]);
    }
  });

  it('a recruiter signed in by password at aal1 is 403 aal2_required; a missing binding is 503', async () => {
    const pw = setup({ caller: { amr: ['password'] } });
    const res = await pw.get(STAGING);
    expect(res.status).toBe(403);
    expect(pw.listed).toEqual([]);
    const unbound = setup({ reader: false });
    expect((await unbound.get(STAGING)).status).toBe(503);
  });

  it('a failed caller check answers its code; a malformed org id is 404', async () => {
    const app = createOutboxRoutes({
      org: {
        context: async () => {
          throw new OrgError('unauthorized');
        },
      },
      reader: () => null,
    });
    const res = await app.request(
      `https://api.test/v1/orgs/${ORG}/demo-outbox`,
      {},
      STAGING as unknown as Env,
    );
    expect(res.status).toBe(401);
    expect((await setup().get(STAGING, 'nope')).status).toBe(404);
  });
});
