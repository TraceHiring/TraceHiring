// Member provisioning against the real schema (specs/m1-test-authoring.md M1-20, R2-14, R5-35, R5-56 c, R5-61 a, E26;
// AT-M1-26 with a fake Auth admin endpoint): the job runs as trace_admin_worker bound to the invite's org, checks the
// email HMAC against the row, finds an existing Auth user through private.auth_user_id_for_invite before creating one,
// provisions through private.provision_invited_member with the row's roles, is idempotent (a try that died after
// creating the user is finished by the next), settles refusals as failed, and its grants refuse everything else. The
// fake endpoint is the real adapter over a fetch that inserts into auth.users, or answers 422 email_exists for a known
// address. Synthetic org and Auth users per file, removed afterwards.
import { randomBytes } from 'node:crypto';
import { createLogger } from '@trace/shared/log';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSupabaseAuthAdmin, type AuthAdmin } from '../src/members/auth-admin.js';
import { inviteEmailHmac } from '../src/members/email-hmac.js';
import { handleInviteMessage, type MembersDeps } from '../src/members/provision.js';
import { sqlInviteStore, type InviteStore } from '../src/members/store.js';
import { cleanupOrg, newId, openHarness, type Harness } from './harness.js';

let h: Harness;
const org = newId();
const otherOrg = newId();
const workspace = newId();
const admin = newId();
const recruiter = newId();
const invitee = newId();
const outsider = newId();
const users = [admin, recruiter, invitee, outsider];
const tag = randomBytes(4).toString('hex');
const address = (who: string) => `p-${who}-${tag}@example.test`;
const PEPPER = randomBytes(24).toString('hex');

const asWorker = <T>(o: string, fn: (s: InviteStore) => Promise<T>): Promise<T> =>
  h.stage('trace_admin_worker', o, (tx) => fn(sqlInviteStore(tx)));

/**
 * The real adapter over a fake /auth/v1/admin/users: a POST inserts the user into auth.users, or answers 422
 * email_exists when the address already has one (as Supabase Auth does); `calls` counts the POSTs.
 */
const auth = (): AuthAdmin & { calls: number } => {
  const a = { calls: 0 };
  const endpoint = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    a.calls += 1;
    const { email } = JSON.parse(String(init?.body)) as { email: string };
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const known = await h.admin.unsafe(
      'select 1 from auth.users where lower(email) = lower(btrim($1))',
      [email],
    );
    if (known.length > 0) return json(422, { code: 422, error_code: 'email_exists' });
    const id = newId();
    users.push(id);
    await h.admin.unsafe(
      "insert into auth.users (id, aud, role, email) values ($1, 'authenticated', 'authenticated', $2)",
      [id, email.trim().toLowerCase()],
    );
    return json(200, { id });
  }) as typeof fetch;
  const adapter = createSupabaseAuthAdmin({
    url: 'https://project.example.test',
    secretKey: ['sb', 'secret', 'synthetic'].join('_'),
    fetch: endpoint,
  });
  return Object.assign(a, { ensureUser: adapter.ensureUser });
};

const deps = (authAdmin: AuthAdmin = auth()): MembersDeps => ({
  db: { run: asWorker },
  authAdmin,
  pepper: PEPPER,
  log: createLogger({ service: 'jobs', version: 'dev', sink: () => {} }),
});

const insertInvite = async (
  o: string,
  email: string,
  patch: { roles?: string; invitedBy?: string; workspace?: string | null } = {},
): Promise<string> => {
  const id = newId();
  await h.admin.unsafe(
    'insert into public.member_invites (id, org_id, email_hmac, roles, workspace_id, invited_by) ' +
      'values ($1, $2, $3, $4::public.org_role[], $5, $6)',
    [
      id,
      o,
      await inviteEmailHmac(email, PEPPER),
      patch.roles ?? '{recruiter}',
      patch.workspace ?? null,
      patch.invitedBy ?? admin,
    ],
  );
  return id;
};

const msg = (inviteId: string, email: string, o: string = org) => ({
  v: 1 as const,
  kind: 'member_invite' as const,
  inviteId,
  orgId: o,
  email,
  displayName: '[synthetic] Invitee',
});

const statusOf = async (id: string): Promise<{ status: string; membership_id: string | null }> => {
  const [row] = await h.admin.unsafe<{ status: string; membership_id: string | null }[]>(
    'select status, membership_id::text as membership_id from public.member_invites where id = $1',
    [id],
  );
  return row!;
};

const deniedCode = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return String((e as { code?: unknown }).code);
  }
};

beforeAll(async () => {
  h = await openHarness();
  for (const [id, who] of [
    [admin, 'admin'],
    [recruiter, 'recruiter'],
    [invitee, 'invitee'],
    [outsider, 'outsider'],
  ] as const) {
    await h.admin.unsafe(
      "insert into auth.users (id, aud, role, email) values ($1, 'authenticated', 'authenticated', $2)",
      [id, address(who)],
    );
  }
  for (const o of [org, otherOrg]) {
    await h.admin.unsafe(
      "insert into public.orgs (id, kind, name, slug) values ($1, 'customer', 'Jobs DB test', $2)",
      [o, `jobs-dbtest-${randomBytes(6).toString('hex')}`],
    );
  }
  await h.admin.unsafe(
    "insert into public.workspaces (id, org_id, name, kind, is_default) values ($1, $2, 'Default', 'default', true)",
    [workspace, org],
  );
  await h.admin.unsafe(
    'insert into public.memberships (org_id, user_id, roles, display_name, status) values ' +
      "($1, $2, '{org_owner,admin}', '[synthetic] Admin', 'active'), ($1, $3, '{recruiter}', '[synthetic] Recruiter', 'active')",
    [org, admin, recruiter],
  );
  // The outsider already belongs to another org (E26).
  await h.admin.unsafe(
    'insert into public.memberships (org_id, user_id, roles, display_name, status) values ' +
      "($1, $2, '{org_owner,admin}', '[synthetic] Outsider', 'active')",
    [otherOrg, outsider],
  );
});

afterAll(async () => {
  if (h === undefined) return;
  await cleanupOrg(h.admin, org);
  await cleanupOrg(h.admin, otherOrg);
  await h.admin.unsafe('delete from auth.users where id = any($1::uuid[])', [
    `{${users.join(',')}}`,
  ]);
  await h.close();
});

describe('member provisioning on the real schema (AT-M1-26)', () => {
  it('an address that does not match the invite HMAC fails the invite before any Auth call', async () => {
    const id = await insertInvite(org, address('mismatch'));
    const a = auth();
    expect(await handleInviteMessage(msg(id, address('invitee')), deps(a))).toBe('failed');
    expect(a.calls).toBe(0);
    expect(await statusOf(id)).toEqual({ status: 'failed', membership_id: null });
  });

  it('R2-14: an invite whose inviter is not an admin is settled as failed', async () => {
    const id = await insertInvite(org, address('invitee'), { invitedBy: recruiter });
    expect(await handleInviteMessage(msg(id, address('invitee')), deps())).toBe('failed');
    expect((await statusOf(id)).status).toBe('failed');
  });

  it('provisions an invited membership with the roles and workspace of the invite row', async () => {
    const id = await insertInvite(org, address('invitee'), {
      roles: '{recruiter,reviewer}',
      workspace,
    });
    expect(
      await handleInviteMessage(msg(id, ` ${address('invitee').toUpperCase()} `), deps()),
    ).toBe('provisioned');
    const inv = await statusOf(id);
    expect(inv.status).toBe('provisioned');
    const [m] = await h.admin.unsafe<
      {
        user_id: string;
        roles: string;
        status: string;
        workspace_id: string;
        display_name: string;
      }[]
    >(
      'select user_id::text as user_id, roles::text as roles, status::text as status, ' +
        'workspace_id::text as workspace_id, display_name from public.memberships where id = $1',
      [inv.membership_id],
    );
    expect(m).toEqual({
      user_id: invitee,
      roles: '{recruiter,reviewer}',
      status: 'invited',
      workspace_id: workspace,
      display_name: '[synthetic] Invitee',
    });
    const audit = await h.admin.unsafe<{ action: string }[]>(
      'select action from public.audit_log where org_id = $1 and (' +
        "(action = 'member_invite.provisioned' and object_id = $2::uuid) or " +
        "(action = 'membership.create' and object_id = $3::uuid)) order by action",
      [org, id, inv.membership_id],
    );
    expect(audit.map((r) => r.action)).toEqual(['member_invite.provisioned', 'membership.create']);

    // A re-delivery is skipped: no second Auth call, no second membership.
    const a = auth();
    expect(await handleInviteMessage(msg(id, address('invitee')), deps(a))).toBe('skipped');
    expect(a.calls).toBe(0);
    const [count] = await h.admin.unsafe<{ n: number }[]>(
      'select count(*)::int as n from public.memberships where org_id = $1 and user_id = $2',
      [org, invitee],
    );
    expect(count?.n).toBe(1);
  });

  it('E26: a user who already exists (a member of another org) is found by the lookup and provisioned', async () => {
    const id = await insertInvite(org, address('outsider'));
    const a = auth();
    expect(await handleInviteMessage(msg(id, address('outsider')), deps(a))).toBe('provisioned');
    expect(a.calls).toBe(0);
    const inv = await statusOf(id);
    const [m] = await h.admin.unsafe<{ user_id: string; org_id: string }[]>(
      'select user_id::text as user_id, org_id::text as org_id from public.memberships where id = $1',
      [inv.membership_id],
    );
    expect(m).toEqual({ user_id: outsider, org_id: org });
  });

  it('E26: a try that died after creating the user is finished by the next with the same user', async () => {
    const fresh = address('fresh');
    const id = await insertInvite(org, fresh);
    const a = auth();
    let dying = true;
    const flaky: MembersDeps = {
      ...deps(a),
      db: {
        run: (o, fn) =>
          asWorker(o, (s) =>
            fn({
              ...s,
              provision: async (...args) => {
                if (dying) {
                  dying = false;
                  throw Object.assign(new Error('connection reset [synthetic]'), { code: '08006' });
                }
                return s.provision(...args);
              },
            }),
          ),
      },
    };
    await expect(handleInviteMessage(msg(id, fresh), flaky)).rejects.toThrow();
    expect((await statusOf(id)).status).toBe('pending');
    expect(a.calls).toBe(1);
    expect(await handleInviteMessage(msg(id, fresh), flaky)).toBe('provisioned');
    expect(a.calls).toBe(1);
    const [u] = await h.admin.unsafe<{ id: string; n: number }[]>(
      'select min(id::text) as id, count(*)::int as n from auth.users where lower(email) = lower($1)',
      [fresh],
    );
    expect(u?.n).toBe(1);
    const [m] = await h.admin.unsafe<{ user_id: string }[]>(
      'select user_id::text as user_id from public.memberships where id = $1',
      [(await statusOf(id)).membership_id],
    );
    expect(m?.user_id).toBe(u?.id);
  });

  it('E26: a second invite for a user who already holds a live membership is settled as failed', async () => {
    const id = await insertInvite(org, address('invitee'));
    expect(await handleInviteMessage(msg(id, address('invitee')), deps())).toBe('failed');
    expect((await statusOf(id)).status).toBe('failed');
  });
});

describe('private.auth_user_id_for_invite (R5-61 a)', () => {
  it('allowed: a pending invite of the job org; the address trimmed and case-folded; null when unknown', async () => {
    const id = await insertInvite(org, address('lookup'));
    expect(await asWorker(org, (s) => s.authUserIdForInvite(id, address('invitee')))).toBe(invitee);
    expect(
      await asWorker(org, (s) =>
        s.authUserIdForInvite(id, `  ${address('invitee').toUpperCase()} `),
      ),
    ).toBe(invitee);
    expect(await asWorker(org, (s) => s.authUserIdForInvite(id, address('nobody')))).toBeNull();
  });

  it('denied: the invite of another org, or one that is not pending (42501)', async () => {
    const foreign = await insertInvite(otherOrg, address('foreign-lookup'), {
      invitedBy: outsider,
    });
    expect(
      await deniedCode(asWorker(org, (s) => s.authUserIdForInvite(foreign, address('invitee')))),
    ).toBe('42501');
    const cancelled = await insertInvite(org, address('cancelled-lookup'));
    await h.admin.unsafe("update public.member_invites set status = 'cancelled' where id = $1", [
      cancelled,
    ]);
    expect(
      await deniedCode(asWorker(org, (s) => s.authUserIdForInvite(cancelled, address('invitee')))),
    ).toBe('42501');
  });

  it('denied: no other role may call it', async () => {
    const id = await insertInvite(org, address('lookup-role'));
    expect(
      await deniedCode(
        h.stage('trace_authoring_worker', org, (tx) =>
          tx.query('select private.auth_user_id_for_invite($1::uuid, $2)', [
            id,
            address('invitee'),
          ]),
        ),
      ),
    ).toBe('42501');
  });
});

describe('the admin worker grants (R5-35, R5-50 c)', () => {
  it('an invite of another org is invisible and cannot be provisioned or failed', async () => {
    const foreign = await insertInvite(otherOrg, address('foreign'), { invitedBy: admin });
    expect(await asWorker(org, (s) => s.loadInvite(foreign))).toBeNull();
    expect(await asWorker(org, (s) => s.markFailed(foreign))).toBe(false);
    expect(
      await deniedCode(asWorker(org, (s) => s.provision(foreign, invitee, '[synthetic] X'))),
    ).toBe('42501');
    expect((await statusOf(foreign)).status).toBe('pending');
  });

  it('the worker cannot change an invite role, write a membership or read the item bank', async () => {
    const id = await insertInvite(org, address('grants'));
    const run = (sql: string, params: string[]) =>
      deniedCode(h.stage('trace_admin_worker', org, (tx) => tx.query(sql, params)));
    expect(
      await run("update public.member_invites set roles = '{admin}' where id = $1", [id]),
    ).toBe('42501');
    expect(
      await run(
        "insert into public.memberships (org_id, user_id, roles, display_name, status) values ($1, $2, '{admin}', 'x', 'active')",
        [org, invitee],
      ),
    ).toBe('42501');
    expect(await run('select 1 from public.item_versions where org_id = $1', [org])).toBe('42501');
    expect(await run('select 1 from public.ai_draft_jobs where org_id = $1', [org])).toBe('42501');
  });
});
