// Test fakes for member provisioning (M1-20, E26, R5-61 a): an in-memory InviteStore that behaves like
// private.provision_invited_member, private.auth_user_id_for_invite and the member_invites guard for the paths the job
// takes (a transaction rolls back on throw), a fake Auth admin API that is the real adapter over a fake HTTP endpoint
// (a second create of the same address answers 422 email_exists; it never silently reuses a user) and a capturing
// logger. Synthetic data only: `@example.test` addresses, made-up ids.
import type { AdminQueueMessage } from '@trace/shared/contracts/m1';
import { createLogger, type Logger } from '@trace/shared/log';
import { createSupabaseAuthAdmin, type AuthAdmin } from './auth-admin.js';
import { normaliseInviteEmail } from './email-hmac.js';
import type { MembersDb } from './provision.js';
import type { InviteRow, InviteStore } from './store.js';

export const ORG = '4a1c7e2d-8b36-4f5a-9d04-6b1f3c85a201';
export const OTHER_ORG = '4a1c7e2d-8b36-4f5a-9d04-6b1f3c85a2ff';
export const INVITE = '4a1c7e2d-8b36-4f5a-9d04-6b1f3c85a202';
export const INVITER = '4a1c7e2d-8b36-4f5a-9d04-6b1f3c85a203';
export const EMAIL = 'p-invitee@example.test';
/** 40 bytes: the job requires at least 32. */
export const PEPPER = ['synthetic', 'pepper', 'for', 'member', 'invite', 'tests'].join('-');

export interface FakeInvite extends InviteRow {
  org_id: string;
  roles: string[];
  workspace_id: string | null;
  invited_by: string;
}

export interface FakeMembership {
  id: string;
  org_id: string;
  user_id: string;
  roles: string[];
  workspace_id: string | null;
  display_name: string;
  status: 'invited' | 'active' | 'removed';
}

export interface FakeWorld {
  invites: Map<string, FakeInvite>;
  memberships: FakeMembership[];
  /** Users whose membership counts as an active admin/owner of ORG (the R2-14 re-check). */
  activeAdmins: Set<string>;
  /** auth.users by normalised address (never rolled back: the Auth API is outside any transaction). */
  authUsers: Map<string, string>;
}

export const invite = (patch: Partial<FakeInvite> = {}): FakeInvite => ({
  id: INVITE,
  org_id: ORG,
  email_hmac: '0'.repeat(64),
  roles: ['recruiter'],
  workspace_id: null,
  status: 'pending',
  membership_id: null,
  invited_by: INVITER,
  ...patch,
});

export const world = (invites: readonly FakeInvite[] = [invite()]): FakeWorld => ({
  invites: new Map(invites.map((i) => [i.id, i])),
  memberships: [],
  activeAdmins: new Set([INVITER]),
  authUsers: new Map(),
});

export const message = (patch: Partial<AdminQueueMessage> = {}): AdminQueueMessage => ({
  v: 1,
  kind: 'member_invite',
  inviteId: INVITE,
  orgId: ORG,
  email: EMAIL,
  displayName: '[synthetic] Invitee',
  ...patch,
});

const guardError = (code: string, reason: string): Error =>
  Object.assign(new Error(`${code === '22023' ? 'TRACE_BAD_INPUT' : 'TRACE_GUARD'}: ${reason}`), {
    code,
  });

let membershipSeq = 0;
let userSeq = 0;

const newUserId = (): string => {
  userSeq += 1;
  return `4a1c7e2d-8b36-4f5a-9d04-${(0xb00 + userSeq).toString(16).padStart(12, '0')}`;
};

/** An Auth user that exists before the job runs (another org's member, or an earlier try's user). */
export const seedAuthUser = (w: FakeWorld, email: string): string => {
  const id = newUserId();
  w.authUsers.set(normaliseInviteEmail(email), id);
  return id;
};

const storeOf = (w: FakeWorld, org: string, fail: (m: keyof InviteStore) => void): InviteStore => {
  const visible = (id: string): FakeInvite | null => {
    const i = w.invites.get(id);
    return i !== undefined && i.org_id === org ? i : null;
  };
  return {
    async loadInvite(id) {
      fail('loadInvite');
      const i = visible(id);
      return i === null
        ? null
        : { id: i.id, email_hmac: i.email_hmac, status: i.status, membership_id: i.membership_id };
    },
    async markFailed(id) {
      fail('markFailed');
      const i = visible(id);
      if (i?.status !== 'pending') return false;
      i.status = 'failed';
      return true;
    },
    async authUserIdForInvite(id, email) {
      fail('authUserIdForInvite');
      if (visible(id)?.status !== 'pending') {
        throw guardError('42501', 'the invite is not pending in the job org');
      }
      return w.authUsers.get(normaliseInviteEmail(email)) ?? null;
    },
    async provision(id, userId, displayName) {
      fail('provision');
      const i = visible(id);
      if (i === null) throw guardError('42501', 'member invite not found in the job org');
      if (i.status === 'provisioned') {
        const m = w.memberships.find((x) => x.id === i.membership_id && x.user_id === userId);
        if (m !== undefined) return m.id;
      }
      if (i.status !== 'pending') throw guardError('42501', 'the invite is not pending');
      const name = displayName.trim();
      if (name.length < 1 || name.length > 120) throw guardError('22023', 'display name');
      if (!w.activeAdmins.has(i.invited_by)) {
        throw guardError('42501', 'the inviter is no longer an active admin or owner');
      }
      if (
        w.memberships.some(
          (m) => m.org_id === org && m.user_id === userId && m.status !== 'removed',
        )
      ) {
        throw guardError('23505', 'the user already has a membership in this org');
      }
      membershipSeq += 1;
      const mid = `4a1c7e2d-8b36-4f5a-9d04-${membershipSeq.toString(16).padStart(12, '0')}`;
      w.memberships.push({
        id: mid,
        org_id: org,
        user_id: userId,
        roles: [...i.roles],
        workspace_id: i.workspace_id,
        display_name: displayName,
        status: 'invited',
      });
      i.status = 'provisioned';
      i.membership_id = mid;
      return mid;
    },
  };
};

export interface FakeDb extends MembersDb {
  readonly orgs: string[];
  failOn(method: keyof InviteStore, always?: boolean): void;
}

export const fakeDb = (w: FakeWorld): FakeDb => {
  const orgs: string[] = [];
  const failures = new Map<keyof InviteStore, boolean>();
  const fail = (m: keyof InviteStore): void => {
    const always = failures.get(m);
    if (always === undefined) return;
    if (!always) failures.delete(m);
    throw Object.assign(new Error('connection reset'), { code: '08006' });
  };
  return {
    orgs,
    failOn: (m, always = false) => {
      failures.set(m, always);
    },
    run: async (orgId, fn) => {
      orgs.push(orgId);
      const invites = new Map([...w.invites].map(([k, v]) => [k, { ...v }]));
      const memberships = w.memberships.map((m) => ({ ...m }));
      try {
        return await fn(storeOf(w, orgId, fail));
      } catch (err) {
        w.invites = invites;
        w.memberships = memberships;
        throw err;
      }
    },
  };
};

export interface FakeAuth extends AuthAdmin {
  /** auth.users by normalised address (the world's; never asserted on as text in logs). */
  readonly users: Map<string, string>;
  /** POSTs to the Auth admin API (creates and 422s). */
  readonly calls: () => number;
  /** The next POST answers 500. */
  failNext(): void;
}

/** The real adapter over a fake /auth/v1/admin/users: creates a user, or 422 email_exists for a known address. */
export const fakeAuth = (w: FakeWorld): FakeAuth => {
  let calls = 0;
  let failing = false;
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const endpoint = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    if (failing) {
      failing = false;
      return json(500, { msg: 'synthetic failure' });
    }
    const { email } = JSON.parse(String(init?.body)) as { email: string };
    const key = normaliseInviteEmail(email);
    if (w.authUsers.has(key)) {
      return json(422, { code: 422, error_code: 'email_exists', msg: 'exists' });
    }
    const id = newUserId();
    w.authUsers.set(key, id);
    return json(200, { id });
  }) as typeof fetch;
  const adapter = createSupabaseAuthAdmin({
    url: 'https://project.example.test',
    secretKey: ['sb', 'secret', 'synthetic'].join('_'),
    fetch: endpoint,
  });
  return {
    users: w.authUsers,
    calls: () => calls,
    failNext: () => {
      failing = true;
    },
    ensureUser: (email, lookup) => adapter.ensureUser(email, lookup),
  };
};

export const capturedLog = (): { log: Logger; lines: string[] } => {
  const lines: string[] = [];
  return {
    lines,
    log: createLogger({ service: 'jobs', version: 'dev', sink: (l) => lines.push(l) }),
  };
};
