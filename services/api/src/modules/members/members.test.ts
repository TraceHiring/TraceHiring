// Member invitations (spec m1 M1-20, §3.2 member_invites, §4.5, §6.11 `POST/GET/DELETE …/members/invites`, R2-14,
// R5-53 c, R5-56 c; AT-M1-26 api part). An admin (aal2) invites by email: the api stores only HMAC-SHA-256(normalised
// address, MEMBER_INVITE_PEPPER) with the roles on the row, then enqueues AdminQueueMessage for workers/jobs (which
// creates the Auth user and provisions the invited membership). The address is never stored, logged or echoed; a
// failed enqueue cancels the invite. DELETE cancels a pending invite (a status update; invites are kept). Synthetic
// data only: addresses and the pepper are built at run time.
import {
  AdminQueueMessage,
  MemberInviteListResponse,
  MemberInviteView,
} from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RestError } from '../tests/org-context.js';
import { fakeDb, idMaker, type Row } from '../tests/rest.test-helpers.js';
import { callerOf, MEMBERSHIP, ORG, USER, WS } from '../tests/tests.test-helpers.js';
import { inviteEmailHmac } from './email-hmac.js';
import { createMembersRoutes, type InviteQueue } from './routes.js';

const PEPPER = ['synthetic', 'pepper', 'for', 'tests', 'only'].join('-');
const ADDRESS = ['p-invitee', 'example.test'].join('@');

const invitesDb = () => {
  const ids = idMaker('ee');
  let tick = 0;
  return fakeDb(
    {
      memberships: [
        { id: MEMBERSHIP, org_id: ORG, user_id: USER, status: 'active', roles: ['admin'] },
      ],
      member_invites: [],
    },
    {
      member_invites: {
        insert: (row, d) => {
          if (
            (d.tables.member_invites ?? []).some(
              (i) =>
                i.org_id === row.org_id &&
                i.email_hmac === row.email_hmac &&
                i.status === 'pending',
            )
          )
            throw new RestError(409, '23505');
          tick += 1;
          return {
            id: ids(),
            status: 'pending',
            membership_id: null,
            invited_by: USER,
            created_at: `2026-10-17T08:00:0${tick}.123456+00:00`,
            ...row,
          };
        },
      },
    },
  );
};

const setup = (opts: { roles?: string[]; aal?: 'aal1' | 'aal2'; pepper?: string | null } = {}) => {
  const db = invitesDb();
  const member = (db.tables.memberships ?? [])[0];
  if (member !== undefined && opts.roles !== undefined) member.roles = opts.roles;
  const sent: unknown[] = [];
  const queue: InviteQueue & { fail: boolean } = {
    fail: false,
    send: async (message) => {
      if (queue.fail) throw new Error('queue down');
      sent.push(message);
    },
  };
  const app = new Hono<{ Bindings: Env }>();
  app.route(
    '/',
    createMembersRoutes({
      org: {
        context: async () => ({
          caller: callerOf({ aal: opts.aal ?? 'aal2', amr: ['totp'] }),
          rest: db.rest,
        }),
      },
      pepper: () => (opts.pepper === undefined ? PEPPER : opts.pepper),
      queue: () => queue,
    }),
  );
  const call = (method: string, path: string, body?: unknown) =>
    app.request(
      `https://api.test/v1/orgs/${ORG}${path}`,
      {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: { 'content-type': 'application/json' },
      },
      {} as Env,
    );
  return { db, call, sent, queue };
};

const invite = (patch: Record<string, unknown> = {}) => ({
  email: `  ${ADDRESS.toUpperCase()} `.trim(),
  roles: ['recruiter'],
  workspaceId: WS,
  displayName: 'Synthetic Invitee',
  ...patch,
});

const codeOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe('inviteEmailHmac (shared with workers/jobs: trim, lower-case, HMAC-SHA-256 hex)', () => {
  it('matches node:crypto on the normalised address, keyed by the pepper', async () => {
    const expected = createHmac('sha256', Buffer.from(PEPPER, 'utf8'))
      .update(Buffer.from(ADDRESS, 'utf8'))
      .digest('hex');
    expect(await inviteEmailHmac(PEPPER, `  ${ADDRESS.toUpperCase()}\n`)).toBe(expected);
    expect(await inviteEmailHmac(PEPPER, ADDRESS)).toMatch(/^[0-9a-f]{64}$/);
    expect(await inviteEmailHmac(`${PEPPER}x`, ADDRESS)).not.toBe(expected);
  });
});

describe('POST …/members/invites', () => {
  it('stores the HMAC and the roles (never the address), enqueues the message, answers the pending invite', async () => {
    const s = setup();
    const res = await s.call('POST', '/members/invites', invite());
    expect(res.status).toBe(201);
    const text = await res.text();
    const view = MemberInviteView.parse(JSON.parse(text));
    expect(view).toMatchObject({
      roles: ['recruiter'],
      workspaceId: WS,
      status: 'pending',
      membershipId: null,
      invitedBy: USER,
    });
    const row = (s.db.tables.member_invites ?? [])[0] as Row;
    expect(row).toMatchObject({ org_id: ORG, roles: ['recruiter'], workspace_id: WS });
    expect(row.email_hmac).toBe(await inviteEmailHmac(PEPPER, ADDRESS));
    expect(JSON.stringify(row)).not.toContain('example.test');
    expect(text).not.toContain('example.test');
    expect(JSON.stringify(s.db.calls)).not.toContain('example.test');
    expect(s.sent).toHaveLength(1);
    expect(AdminQueueMessage.parse(s.sent[0])).toEqual({
      v: 1,
      kind: 'member_invite',
      inviteId: view.id,
      orgId: ORG,
      email: ADDRESS,
      displayName: 'Synthetic Invitee',
    });
  });

  it('a second pending invite for the same address is 409; nothing is enqueued', async () => {
    const s = setup();
    expect((await s.call('POST', '/members/invites', invite())).status).toBe(201);
    const again = await s.call('POST', '/members/invites', invite({ roles: ['reviewer'] }));
    expect(again.status).toBe(409);
    expect(s.sent).toHaveLength(1);
  });

  it('a failed enqueue cancels the invite and answers 503 (the address is kept nowhere)', async () => {
    const s = setup();
    s.queue.fail = true;
    const res = await s.call('POST', '/members/invites', invite());
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('{"error":{"code":"unavailable"}}');
    expect((s.db.tables.member_invites ?? [])[0]?.status).toBe('cancelled');
  });

  it('no pepper bound is 503 before any write', async () => {
    for (const pepper of [null, '', 'short']) {
      const s = setup({ pepper });
      const res = await s.call('POST', '/members/invites', invite());
      expect(res.status).toBe(503);
      expect(s.db.tables.member_invites).toEqual([]);
    }
  });

  it('a bad body is 400 and never echoes the address; an org-wide role with a workspace is 400', async () => {
    const s = setup();
    for (const body of [
      invite({ email: 'not-an-address' }),
      invite({ roles: [] }),
      invite({ roles: ['recruiter', 'recruiter'] }),
      invite({ extra: 1 }),
      invite({ roles: ['admin'] }),
    ]) {
      const res = await s.call('POST', '/members/invites', body);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('{"error":{"code":"bad_request"}}');
    }
    expect(s.db.tables.member_invites).toEqual([]);
  });

  it('only an admin at aal2: recruiter or owner without admin is 404, aal1 admin 403', async () => {
    for (const [roles, aal, status] of [
      [['recruiter'], 'aal2', 404],
      [['org_owner'], 'aal2', 404],
      [['admin'], 'aal1', 403],
    ] as const) {
      const s = setup({ roles: [...roles], aal });
      expect((await s.call('POST', '/members/invites', invite())).status).toBe(status);
      expect((await s.call('GET', '/members/invites')).status).toBe(status);
      expect(
        (await s.call('DELETE', '/members/invites/ee000000-0000-4000-8000-000000000001')).status,
      ).toBe(status);
      expect(s.sent).toEqual([]);
    }
  });
});

describe('GET and DELETE …/members/invites', () => {
  it('lists newest first in keyset pages of 50 (no address, no HMAC)', async () => {
    const s = setup();
    const rows = Array.from({ length: 52 }, (_, n) => ({
      id: `ee100000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`,
      org_id: ORG,
      email_hmac: 'ab'.repeat(32),
      roles: ['reviewer'],
      workspace_id: null,
      status: 'pending',
      membership_id: null,
      invited_by: USER,
      created_at: `2026-10-17T08:00:00.${String(100000 + n)}+00:00`,
    }));
    s.db.tables.member_invites = rows;
    const first = MemberInviteListResponse.parse(
      await (await s.call('GET', '/members/invites')).json(),
    );
    expect(first.invites).toHaveLength(50);
    expect(first.invites[0]?.id).toBe(rows[51]?.id);
    expect(JSON.stringify(first)).not.toContain('abab');
    const next = MemberInviteListResponse.parse(
      await (await s.call('GET', `/members/invites?cursor=${first.nextCursor ?? ''}`)).json(),
    );
    expect(next.invites.map((i) => i.id)).toEqual([rows[1]?.id, rows[0]?.id]);
    expect(next.nextCursor).toBeNull();
    expect((await s.call('GET', '/members/invites?cursor=bad')).status).toBe(400);
    expect((await s.call('GET', '/members/invites?other=1')).status).toBe(400);
  });

  it('DELETE cancels a pending invite and answers it; a settled one is 409; an unknown one 404', async () => {
    const s = setup();
    const created = MemberInviteView.parse(
      await (await s.call('POST', '/members/invites', invite())).json(),
    );
    const res = await s.call('DELETE', `/members/invites/${created.id}`);
    expect(res.status).toBe(200);
    expect(MemberInviteView.parse(await res.json())).toMatchObject({
      id: created.id,
      status: 'cancelled',
    });
    expect((await s.call('DELETE', `/members/invites/${created.id}`)).status).toBe(409);
    expect(
      (await s.call('DELETE', '/members/invites/ee000000-0000-4000-8000-000000000099')).status,
    ).toBe(404);
    expect((await s.call('DELETE', '/members/invites/nope')).status).toBe(404);
    expect(await codeOf(await s.call('DELETE', '/members/invites/nope'))).toBe('not_found');
  });
});
