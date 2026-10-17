// AT-D12 (api part; rule 9) and the invitation rows of spec §6.2 (D1-1, D1-2, L-1, R-14): `adultConfirmedByInviter:
// false` creates `blocked_age` with no link and no message; any other answer stores only the SHA-256 of a fresh
// 32-byte token, writes the invite to the demo outbox through the vendors Messaging mock, and only then sets `sent`
// as trace_api; the link is in this response only; the list has no contact; revoke from created/sent only.
import { CreateInvitationResponse, InvitationListResponse } from '@trace/shared/contracts/d1';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../candidate/encoding.js';
import {
  NOW,
  ORG,
  ORG_B,
  ORIGIN,
  T1,
  TB,
  T_DRAFT,
  TOKEN,
  V1,
  callerFor,
  invitationsApp,
  rowsOf,
  writesOf,
} from './invitation.test-helpers.js';
import { INVITE_TTL_SECONDS, deliveryFromEnv } from './routes.js';

const path = (test: string = T1, org: string = ORG) => `/v1/orgs/${org}/tests/${test}/invitations`;
const invite = (patch: Record<string, unknown> = {}) => ({
  contactEmail: 'cand01@example.test',
  adultConfirmedByInviter: true,
  ...patch,
});
const codeOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe('POST …/invitations: an adult (or not sure) candidate', () => {
  for (const adult of [true, null]) {
    it(`adultConfirmedByInviter ${String(adult)}: hash only, outbox first, then sent; the link once`, async () => {
      const { db, d, call } = invitationsApp('rec');
      const res = await call('POST', path(), invite({ adultConfirmedByInviter: adult }));
      expect(res.status).toBe(201);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = CreateInvitationResponse.parse(await res.json());
      expect(body).toEqual({
        invitationId: rowsOf(db, 'invitations')[0]?.id,
        label: 'Candidate 1',
        status: 'sent',
        inviteUrl: `${ORIGIN}/i#${TOKEN}`,
      });
      // The insert is the caller's, with exactly the creation columns; the pins and label come from the trigger.
      const [row] = rowsOf(db, 'invitations');
      expect(row).toMatchObject({
        org_id: ORG,
        test_id: T1,
        test_version_id: V1,
        contact_email: 'cand01@example.test',
        link_token_hash: await sha256Hex(TOKEN),
        adult_confirmed_by_inviter: adult,
        expires_at: new Date(NOW + INVITE_TTL_SECONDS * 1000).toISOString(),
        status: 'sent',
      });
      expect(JSON.stringify(db.tables)).not.toContain(TOKEN);
      expect(writesOf(db)).toEqual(['insert:invitations']);
      // L-1: the outbox write precedes `sent`.
      expect(d.events).toEqual(['outbox:invite', 'sent']);
      const [entry] = await d.outbox.list(ORG);
      expect(entry).toMatchObject({ kind: 'invite', candidateLabel: 'Candidate 1' });
      expect(entry?.bodyText).toContain(`${ORIGIN}/i#${TOKEN}`);
      expect(JSON.stringify(await d.outbox.list(ORG))).not.toContain('@example.test');
      expect(d.closed).toBe(1);
    });
  }

  it('each invitation gets its own label; a second live invite to the same contact is 409', async () => {
    const { call } = invitationsApp('rec');
    expect((await call('POST', path(), invite())).status).toBe(201);
    const second = CreateInvitationResponse.parse(
      await (await call('POST', path(), invite({ contactEmail: 'cand02@example.test' }))).json(),
    );
    expect(second.label).toBe('Candidate 2');
    const dup = await call('POST', path(), invite());
    expect(dup.status).toBe(409);
    expect(await codeOf(dup)).toBe('conflict');
  });
});

describe('AT-D12: the inviter says the candidate is under 18 (rule 9)', () => {
  it('creates blocked_age with no link and no message, and never sets sent', async () => {
    const { db, d, call } = invitationsApp('rec');
    const res = await call('POST', path(), invite({ adultConfirmedByInviter: false }));
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(CreateInvitationResponse.parse(JSON.parse(text))).toEqual({
      invitationId: rowsOf(db, 'invitations')[0]?.id,
      label: 'Candidate 1',
      status: 'blocked_age',
      inviteUrl: null,
    });
    expect(rowsOf(db, 'invitations')[0]).toMatchObject({
      status: 'blocked_age',
      adult_confirmed_by_inviter: false,
    });
    expect(d.events).toEqual([]);
    expect(await d.outbox.list(ORG)).toEqual([]);
  });

  it('a row the database returns as blocked_age is blocked even if the request said adult', async () => {
    const { db, d, call } = invitationsApp('rec');
    const hooks = db.hooks.invitations;
    const original = hooks?.insert;
    if (hooks !== undefined && original !== undefined) {
      hooks.insert = (row, x) => ({ ...original(row, x), status: 'blocked_age' });
    }
    const res = await call('POST', path(), invite());
    expect(CreateInvitationResponse.parse(await res.json()).inviteUrl).toBeNull();
    expect(d.events).toEqual([]);
  });

  it('an inviter "no" that the database did not block is refused without a link or message', async () => {
    const { db, d, call } = invitationsApp('rec');
    const hooks = db.hooks.invitations;
    const original = hooks?.insert;
    if (hooks !== undefined && original !== undefined) {
      hooks.insert = (row, x) => ({ ...original(row, x), status: 'created' });
    }
    const res = await call('POST', path(), invite({ adultConfirmedByInviter: false }));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('{"error":{"code":"unavailable"}}');
    expect(d.events).toEqual([]);
  });
});

describe('POST …/invitations: delivery failures fail closed', () => {
  it('an outbox failure answers 503 without the link and withdraws the invitation', async () => {
    const { db, d, call } = invitationsApp('rec');
    d.failOutbox = true;
    const res = await call('POST', path(), invite());
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('{"error":{"code":"unavailable"}}');
    expect(rowsOf(db, 'invitations')[0]?.status).toBe('revoked');
    expect(d.events).toEqual([]);
    // The contact can be invited again.
    d.failOutbox = false;
    expect((await call('POST', path(), invite())).status).toBe(201);
  });

  it('a failed or no-op `sent` step still returns the delivered link with the stored status', async () => {
    for (const sent of ['throw', 'none'] as const) {
      const { d, call } = invitationsApp('rec');
      d.sent = sent;
      const body = CreateInvitationResponse.parse(
        await (await call('POST', path(), invite())).json(),
      );
      expect(body.status, sent).toBe('created');
      expect(body.inviteUrl).toBe(`${ORIGIN}/i#${TOKEN}`);
      expect(d.events).toEqual(['outbox:invite', 'sent']);
    }
  });

  it('no delivery (production, a missing binding) is 503 before any write', async () => {
    const { db, call } = invitationsApp('rec', { delivery: 'none' });
    const res = await call('POST', path(), invite());
    expect(res.status).toBe(503);
    expect(writesOf(db)).toEqual([]);
  });

  it('deliveryFromEnv is null in production, without TRACE_ENV, without the switch, origin or db url', () => {
    const ok = {
      TRACE_ENV: 'staging',
      DEMO_OUTBOX: '1',
      OUTBOX: {},
      CANDIDATE_APP_ORIGIN: ORIGIN,
    };
    for (const env of [
      { ...ok, TRACE_ENV: 'production' },
      { ...ok, TRACE_ENV: undefined },
      { ...ok, TRACE_ENV: '' },
      { ...ok, DEMO_OUTBOX: '0' },
      { ...ok, OUTBOX: undefined },
      { ...ok, CANDIDATE_APP_ORIGIN: 'javascript:alert(1)' },
      { ...ok, CANDIDATE_APP_ORIGIN: `${ORIGIN}/path` },
      ok, // no API_DB_URL
    ]) {
      expect(deliveryFromEnv(env as unknown as Env)).toBeNull();
    }
  });
});

describe('POST …/invitations: who and what', () => {
  it('a test without a published version is 409 before any write', async () => {
    const { db, call } = invitationsApp('rec');
    const res = await call('POST', path(T_DRAFT), invite());
    expect(res.status).toBe(409);
    expect(writesOf(db)).toEqual([]);
  });

  it('a reviewer, a hiring manager, another org admin and another org test are 404 with no write', async () => {
    for (const who of ['rev', 'hm', 'bAdmin'] as const) {
      const { db, call } = invitationsApp(who);
      const res = await call('POST', path(), invite());
      expect(res.status, who).toBe(404);
      expect(await res.text()).toBe('{"error":{"code":"not_found"}}');
      expect(writesOf(db)).toEqual([]);
    }
    const { db, call } = invitationsApp('admin');
    expect((await call('POST', path(TB), invite())).status).toBe(404);
    expect((await call('POST', path(TB, ORG_B), invite())).status).toBe(404);
    expect(writesOf(db)).toEqual([]);
  });

  it('a recruiter signed in by password at aal1 is 403 aal2_required', async () => {
    const { db, call } = invitationsApp('rec', {
      caller: callerFor('rec', { amr: ['password'] }),
    });
    const res = await call('POST', path(), invite());
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe('aal2_required');
    expect(writesOf(db)).toEqual([]);
  });

  it('a body that breaks the contract is 400 and never echoed (real address, missing answer, extra key)', async () => {
    const { db, call } = invitationsApp('rec');
    for (const body of [
      invite({ contactEmail: 'someone@gmail.com' }),
      invite({ contactEmail: 'Cand01@example.test' }),
      { contactEmail: 'cand01@example.test' },
      invite({ name: 'Synthetic Person' }),
      invite({ adultConfirmedByInviter: 'yes' }),
      'nope',
    ]) {
      const res = await call('POST', path(), body);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('{"error":{"code":"bad_request"}}');
    }
    expect(writesOf(db)).toEqual([]);
  });
});

describe('GET …/invitations and revoke', () => {
  it('lists label, status and times only; no contact of any kind', async () => {
    const { call } = invitationsApp('rec');
    await call('POST', path(), invite());
    await call(
      'POST',
      path(),
      invite({ contactEmail: 'cand02@example.test', adultConfirmedByInviter: false }),
    );
    const res = await call('GET', path());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('@');
    const list = InvitationListResponse.parse(JSON.parse(text)).invitations;
    expect(list.map((i) => [i.label, i.status])).toEqual([
      ['Candidate 1', 'sent'],
      ['Candidate 2', 'blocked_age'],
    ]);
    for (const i of list)
      expect(Object.keys(i).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'label', 'status']);
  });

  it('revokes a sent invitation as the caller; blocked, started or revoked ones are 409', async () => {
    const { db, call } = invitationsApp('rec');
    const a = CreateInvitationResponse.parse(await (await call('POST', path(), invite())).json());
    const res = await call('POST', `${path()}/${a.invitationId}/revoke`);
    expect(res.status).toBe(200);
    const list = InvitationListResponse.parse(await res.json()).invitations;
    expect(list.find((i) => i.id === a.invitationId)?.status).toBe('revoked');
    const update = db.calls.filter((c) => c.method === 'update').at(-1);
    expect(update?.query).toMatchObject({
      status: 'in.(created,sent)',
      org_id: `eq.${ORG}`,
      test_id: `eq.${T1}`,
    });

    const b = CreateInvitationResponse.parse(
      await (
        await call(
          'POST',
          path(),
          invite({ contactEmail: 'cand02@example.test', adultConfirmedByInviter: false }),
        )
      ).json(),
    );
    const c = CreateInvitationResponse.parse(
      await (await call('POST', path(), invite({ contactEmail: 'cand03@example.test' }))).json(),
    );
    const started = rowsOf(db, 'invitations').find((i) => i.id === c.invitationId);
    if (started !== undefined) started.status = 'started';
    for (const id of [a.invitationId, b.invitationId, c.invitationId]) {
      const r = await call('POST', `${path()}/${id}/revoke`);
      expect(r.status).toBe(409);
      expect(await codeOf(r)).toBe('conflict');
    }
  });

  it('an unknown invitation, one of another test and a malformed id are 404', async () => {
    const { call } = invitationsApp('rec');
    const a = CreateInvitationResponse.parse(await (await call('POST', path(), invite())).json());
    for (const p of [
      `${path()}/41000000-0000-4000-8000-000000000099/revoke`,
      `${path(T_DRAFT)}/${a.invitationId}/revoke`,
      `${path()}/nope/revoke`,
    ]) {
      expect((await call('POST', p)).status, p).toBe(404);
    }
  });

  it('a reviewer cannot list or revoke (404)', async () => {
    const { call } = invitationsApp('rev');
    expect((await call('GET', path())).status).toBe(404);
    expect(
      (await call('POST', `${path()}/41000000-0000-4000-8000-000000000001/revoke`)).status,
    ).toBe(404);
  });
});
