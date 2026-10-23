// Test fakes for member provisioning (M1-20): an in-memory InviteStore that behaves like private.provision_invited_member
// and the member_invites guard for the paths the job takes (a transaction rolls back on throw), a fake Auth admin API
// (E26: an existing user is reused) and a capturing logger. Synthetic data only: `@example.test` addresses, made-up ids.
import type { AdminQueueMessage } from '@trace/shared/contracts/m1';
import { createLogger, type Logger } from '@trace/shared/log';
import type { AuthAdmin } from './auth-admin.js';
import type { MembersDb } from './provision.js';
import type { InviteRow, InviteStore } from './store.js';

export const ORG = '4a1c7e2d-8b36-4f5a-9d04-6b1f3c85a201';
export const INVITE = '4a1c7e2d-8b36-4f5a-9d04-6b1f3c85a202';
export const INVITER = '4a1c7e2d-8b36-4f5a-9d04-6b1f3c85a203';
export const EMAIL = 'p-invitee@example.test';
export const PEPPER = ['synthetic', 'pepper', 'for', 'tests'].join('-');

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
  /** Users by normalised address (the Auth side; never asserted on as text in logs). */
  readonly users: Map<string, string>;
  readonly calls: () => number;
  failNext(): void;
}

let userSeq = 0;

export const fakeAuth = (): FakeAuth => {
  const users = new Map<string, string>();
  let calls = 0;
  let failing = false;
  return {
    users,
    calls: () => calls,
    failNext: () => {
      failing = true;
    },
    ensureUser: async (email) => {
      calls += 1;
      if (failing) {
        failing = false;
        throw new Error('auth_admin_failed');
      }
      const key = email.trim().toLowerCase();
      const existing = users.get(key);
      if (existing !== undefined) return existing;
      userSeq += 1;
      const id = `4a1c7e2d-8b36-4f5a-9d04-${(0xb00 + userSeq).toString(16).padStart(12, '0')}`;
      users.set(key, id);
      return id;
    },
  };
};

export const capturedLog = (): { log: Logger; lines: string[] } => {
  const lines: string[] = [];
  return {
    lines,
    log: createLogger({ service: 'jobs', version: 'dev', sink: (l) => lines.push(l) }),
  };
};
