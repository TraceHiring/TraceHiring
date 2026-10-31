// Fixtures for the invitation tests: the fake PostgREST of tests/rest.test-helpers.ts with hooks that model, for one
// signed-in persona, migration 2's invitations rules (the label trigger: staff of the test's workspace, a published
// version of this test, `Candidate N`, `blocked_age` when the inviter says no; the contact CHECK; the live-contact
// unique index; revoke only from created/sent), the real demo outbox writer over the vendors Messaging mock, and a
// trace_api `sent` step that records its order. The real rules are covered by supabase/tests/rls_d1_invitations and
// rls_d1_age (lead) and by the rolled-back psql probe recorded in the writer report. Synthetic data only.
import { createDemoOutbox, type OutboxWriter } from '../outbox/outbox-writer.js';
import { fakeOutboxNamespace } from '../outbox/outbox.test-helpers.js';
import { RestError, type OrgCaller } from '../tests/org-context.js';
import { fakeDb, idMaker, type FakeDb, type Row } from '../tests/rest.test-helpers.js';
import { createInvitationsRoutes, type InvitationDelivery } from './routes.js';

export const ORG = 'a1000000-0000-4000-8000-000000000001';
export const ORG_B = 'a1000000-0000-4000-8000-000000000003';
export const WS = 'b1000000-0000-4000-8000-000000000001';
export const T1 = 'e1000000-0000-4000-8000-000000000001';
/** A test whose only version is a draft. */
export const T_DRAFT = 'e1000000-0000-4000-8000-000000000002';
export const TB = 'e1000000-0000-4000-8000-00000000000b';
export const V1 = 'f1000000-0000-4000-8000-000000000001';
export const ORIGIN = 'https://trace-candidate-staging.pages.dev';
export const NOW = Date.parse('2026-10-17T08:00:00.000Z');
/** A fixed 43-character base64url token built at run time (never a secret-shaped literal). */
export const TOKEN = 'T'.repeat(21) + '_' + 'k'.repeat(21);

interface Persona {
  user: string;
  membership: string;
  org: string;
  roles: string[];
}
export const PERSONAS = {
  rec: {
    user: '00000000-0000-4000-8000-000000000005',
    membership: 'd1000000-0000-4000-8000-000000000005',
    org: ORG,
    roles: ['recruiter'],
  },
  admin: {
    user: '00000000-0000-4000-8000-000000000003',
    membership: 'd1000000-0000-4000-8000-000000000003',
    org: ORG,
    roles: ['admin'],
  },
  rev: {
    user: '00000000-0000-4000-8000-000000000007',
    membership: 'd1000000-0000-4000-8000-000000000007',
    org: ORG,
    roles: ['reviewer'],
  },
  hm: {
    user: '00000000-0000-4000-8000-000000000008',
    membership: 'd1000000-0000-4000-8000-000000000008',
    org: ORG,
    roles: ['hiring_manager'],
  },
  bAdmin: {
    user: '00000000-0000-4000-8000-00000000000e',
    membership: 'd1000000-0000-4000-8000-00000000000e',
    org: ORG_B,
    roles: ['org_owner', 'admin'],
  },
} satisfies Record<string, Persona>;
export type PersonaName = keyof typeof PERSONAS;

export const callerFor = (name: PersonaName, patch: Partial<OrgCaller> = {}): OrgCaller => {
  const privileged = PERSONAS[name].roles.some((r) =>
    ['org_owner', 'admin', 'reviewer'].includes(r),
  );
  return {
    userId: PERSONAS[name].user,
    aal: privileged ? 'aal2' : 'aal1',
    amr: privileged ? ['password', 'totp'] : ['otp'],
    jwt: 'h.p.s',
    ...patch,
  };
};

const denied = () => new RestError(403, '42501');
const CONTACT = /^[a-z0-9._+-]{1,64}@example\.test$/;

export const invitationsDb = (who: PersonaName) => {
  const me: Persona = PERSONAS[who];
  const staff = (org: unknown) =>
    org === me.org && me.roles.some((r) => ['org_owner', 'admin', 'recruiter'].includes(r));
  const newId = idMaker('41');
  const candidate = idMaker('c4');
  const db: FakeDb & { rest: ReturnType<typeof fakeDb>['rest'] } = fakeDb({
    memberships: Object.values(PERSONAS).map((p: Persona) => ({
      id: p.membership,
      org_id: p.org,
      user_id: p.user,
      roles: p.roles,
      status: 'active',
    })),
    tests: [
      {
        id: T1,
        org_id: ORG,
        workspace_id: WS,
        name: 'Test One',
        created_at: '2026-10-17T07:00:00.000+00:00',
        invitation_seq: 0,
      },
      {
        id: T_DRAFT,
        org_id: ORG,
        workspace_id: WS,
        name: 'Draft Test',
        created_at: '2026-10-17T07:00:00.000+00:00',
        invitation_seq: 0,
      },
      {
        id: TB,
        org_id: ORG_B,
        workspace_id: 'b1000000-0000-4000-8000-000000000004',
        name: 'Test B',
        created_at: '2026-10-17T07:00:00.000+00:00',
        invitation_seq: 0,
      },
    ],
    test_versions: [
      { id: V1, org_id: ORG, test_id: T1, version_no: 1, status: 'published' },
      {
        id: 'f1000000-0000-4000-8000-000000000002',
        org_id: ORG,
        test_id: T_DRAFT,
        version_no: 1,
        status: 'draft',
      },
    ],
    invitations: [],
  });
  db.hooks.memberships = { visible: (row) => row.user_id === me.user || staff(row.org_id) };
  db.hooks.tests = { visible: (row) => staff(row.org_id) };
  db.hooks.test_versions = { visible: (row) => staff(row.org_id) };
  db.hooks.invitations = {
    visible: (row) => staff(row.org_id),
    insert: (row, d) => {
      const test = (d.tables.tests ?? []).find(
        (t) => t.id === row.test_id && t.org_id === row.org_id,
      );
      if (test === undefined || !staff(test.org_id)) throw denied();
      const version = (d.tables.test_versions ?? []).find(
        (v) => v.id === row.test_version_id && v.org_id === row.org_id,
      );
      if (version === undefined) throw new RestError(409, '23503');
      if (version.test_id !== row.test_id || version.status !== 'published') throw denied();
      if (!CONTACT.test(String(row.contact_email))) throw new RestError(400, '23514');
      if (
        (d.tables.invitations ?? []).some(
          (i) =>
            i.org_id === row.org_id &&
            i.test_id === row.test_id &&
            i.contact_email === row.contact_email &&
            i.status !== 'revoked',
        )
      ) {
        throw new RestError(409, '23505');
      }
      test.invitation_seq = Number(test.invitation_seq) + 1;
      const blocked = row.adult_confirmed_by_inviter === false;
      return {
        id: newId(),
        candidate_id: candidate(),
        session_id: null,
        workspace_id: test.workspace_id,
        candidate_label: `Candidate ${String(test.invitation_seq)}`,
        status: blocked ? 'blocked_age' : 'created',
        age_block_source: blocked ? 'inviter' : null,
        created_at: `2026-10-17T08:00:0${String(test.invitation_seq)}.000+00:00`,
        ...row,
      };
    },
    // invitations_update_staff USING: created/sent only; the guard lets org users set `revoked` only.
    updatable: (row) => row.status === 'created' || row.status === 'sent',
    update: (_old, next) => {
      if (next.status !== 'revoked') throw denied();
      return next;
    },
  };
  return db;
};

export interface DeliveryFake {
  delivery: InvitationDelivery;
  events: string[];
  ns: ReturnType<typeof fakeOutboxNamespace>;
  outbox: NonNullable<ReturnType<typeof createDemoOutbox>>;
  failOutbox: boolean;
  /** 'ok' moves the row; 'none' moves nothing; 'throw' rejects. */
  sent: 'ok' | 'none' | 'throw';
  closed: number;
}

export const fakeDelivery = (db: FakeDb): DeliveryFake => {
  const ns = fakeOutboxNamespace();
  const outbox = createDemoOutbox({ TRACE_ENV: 'staging', DEMO_OUTBOX: '1' }, ns);
  if (outbox === null) throw new Error('outbox');
  const fake: DeliveryFake = {
    events: [],
    ns,
    outbox,
    failOutbox: false,
    sent: 'ok',
    closed: 0,
    delivery: undefined as unknown as InvitationDelivery,
  };
  const writer: OutboxWriter = {
    write: async (orgId, message) => {
      if (fake.failOutbox) throw new Error('outbox_down');
      await outbox.write(orgId, message);
      fake.events.push(`outbox:${message.kind}`);
    },
  };
  fake.delivery = {
    outbox: writer,
    candidateOrigin: ORIGIN,
    markSent: async (orgId, invitationId) => {
      fake.events.push('sent');
      if (fake.sent === 'throw') throw new Error('db_down');
      if (fake.sent === 'none') return false;
      const row = (db.tables.invitations ?? []).find(
        (i) => i.id === invitationId && i.org_id === orgId,
      );
      if (row === undefined || row.status !== 'created') return false;
      row.status = 'sent';
      return true;
    },
    close: async () => {
      fake.closed += 1;
    },
  };
  return fake;
};

export const invitationsApp = (
  who: PersonaName,
  opts: { caller?: OrgCaller; delivery?: 'fake' | 'none' } = {},
) => {
  const db = invitationsDb(who);
  const d = fakeDelivery(db);
  const caller = opts.caller ?? callerFor(who);
  const app = createInvitationsRoutes({
    org: { context: async () => ({ caller, rest: db.rest }) },
    delivery: () => (opts.delivery === 'none' ? null : d.delivery),
    now: () => NOW,
    newToken: () => TOKEN,
  });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(
      `https://api.test${path}`,
      {
        method,
        ...(body === undefined
          ? {}
          : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
        headers: { 'content-type': 'application/json' },
      },
      {} as Env,
    );
  return { db, d, call };
};

export const writesOf = (db: FakeDb) =>
  db.calls.filter((c) => c.method !== 'select').map((c) => `${c.method}:${c.table}`);

export const rowsOf = (db: FakeDb, table: string): Row[] => db.tables[table] ?? [];
