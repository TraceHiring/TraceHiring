// Fixtures for the assignments tests: the fake PostgREST of tests/rest.test-helpers.ts with hooks that model, for one
// signed-in persona, the RLS policies of migration 1 (assignments_*_owner_admin / _recruiter / _select_*,
// memberships_select_*, tests_select_*), the assignments guard (active membership holding the role; test of the
// org) and the unique key. The real policies are covered by supabase/tests/rls_d1_assignments.test.sql (lead) and by
// the rolled-back psql probe recorded in docs/reviews/D1-r3a-writer-report.md. Synthetic data only.
import { Hono } from 'hono';
import type { OrgCaller } from '../tests/org-context.js';
import { RestError } from '../tests/org-context.js';
import { fakeDb, idMaker, type FakeDb, type Row } from '../tests/rest.test-helpers.js';
import { createAssignmentsRoutes } from './routes.js';

export const ORG = 'a1000000-0000-4000-8000-000000000001';
export const ORG_B = 'a1000000-0000-4000-8000-000000000003';
export const WS = 'b1000000-0000-4000-8000-000000000001';
export const WS_B = 'b1000000-0000-4000-8000-000000000004';
/** T1 was created by REC (assigned as recruiter); T2 by REC2; TB is org B's. */
export const T1 = 'e1000000-0000-4000-8000-000000000001';
export const T2 = 'e1000000-0000-4000-8000-000000000002';
export const TB = 'e1000000-0000-4000-8000-00000000000b';

const T0 = '2026-10-17T08:00:00.000+00:00';

interface Persona {
  user: string;
  membership: string;
  org: string;
  roles: string[];
  status?: string;
}
export const PERSONAS = {
  owner: {
    user: '00000000-0000-4000-8000-000000000001',
    membership: 'd1000000-0000-4000-8000-000000000001',
    org: ORG,
    roles: ['org_owner', 'admin'],
  },
  rec: {
    user: '00000000-0000-4000-8000-000000000005',
    membership: 'd1000000-0000-4000-8000-000000000005',
    org: ORG,
    roles: ['recruiter'],
  },
  rec2: {
    user: '00000000-0000-4000-8000-000000000013',
    membership: 'd1000000-0000-4000-8000-000000000013',
    org: ORG,
    roles: ['recruiter'],
  },
  rev: {
    user: '00000000-0000-4000-8000-000000000007',
    membership: 'd1000000-0000-4000-8000-000000000007',
    org: ORG,
    roles: ['reviewer'],
  },
  rev2: {
    user: '00000000-0000-4000-8000-000000000014',
    membership: 'd1000000-0000-4000-8000-000000000014',
    org: ORG,
    roles: ['reviewer'],
  },
  hm: {
    user: '00000000-0000-4000-8000-000000000008',
    membership: 'd1000000-0000-4000-8000-000000000008',
    org: ORG,
    roles: ['hiring_manager'],
  },
  gone: {
    user: '00000000-0000-4000-8000-000000000015',
    membership: 'd1000000-0000-4000-8000-000000000015',
    org: ORG,
    roles: ['reviewer'],
    status: 'removed',
  },
  bAdmin: {
    user: '00000000-0000-4000-8000-00000000000e',
    membership: 'd1000000-0000-4000-8000-00000000000e',
    org: ORG_B,
    roles: ['org_owner', 'admin'],
  },
  bRev: {
    user: '00000000-0000-4000-8000-000000000016',
    membership: 'd1000000-0000-4000-8000-000000000016',
    org: ORG_B,
    roles: ['reviewer'],
  },
} satisfies Record<string, Persona>;
export type PersonaName = keyof typeof PERSONAS;

const NAMES: Record<PersonaName, string> = {
  owner: 'Persona Owner',
  rec: 'Persona Recruiter',
  rec2: 'Persona Recruiter Two',
  rev: 'Persona Reviewer',
  rev2: 'Persona Reviewer Two',
  hm: 'Persona Hiring Manager',
  gone: 'Persona Removed',
  bAdmin: 'Persona B Admin',
  bRev: 'Persona B Reviewer',
};

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

/** Whether the caller's membership counts (the same truth table as private.membership_counts_for). */
const counts = (p: Persona, caller: OrgCaller) =>
  (p.status ?? 'active') === 'active' &&
  (caller.aal === 'aal2' ||
    (!p.roles.some((r) => ['org_owner', 'admin', 'reviewer'].includes(r)) &&
      caller.amr.includes('otp') &&
      !caller.amr.includes('password')));

export const assignmentsDb = (who: PersonaName, caller: OrgCaller = callerFor(who)) => {
  const me: Persona = PERSONAS[who];
  const live = counts(me, caller);
  const has = (role: string) => live && me.roles.includes(role);
  const orgWide = (org: unknown) => org === me.org && (has('org_owner') || has('admin'));
  const staff = (org: unknown) =>
    org === me.org && (has('org_owner') || has('admin') || has('recruiter'));
  const newId = idMaker('a5');
  const db: FakeDb & { rest: ReturnType<typeof fakeDb>['rest'] } = fakeDb(
    {
      memberships: Object.entries(PERSONAS).map(([name, p]: [string, Persona]) => ({
        id: p.membership,
        org_id: p.org,
        user_id: p.user,
        roles: p.roles,
        status: p.status ?? 'active',
        display_name: NAMES[name as PersonaName],
      })),
      tests: [
        {
          id: T1,
          org_id: ORG,
          workspace_id: WS,
          name: 'Test One',
          created_at: T0,
          invitation_seq: 0,
        },
        {
          id: T2,
          org_id: ORG,
          workspace_id: WS,
          name: 'Test Two',
          created_at: T0,
          invitation_seq: 0,
        },
        {
          id: TB,
          org_id: ORG_B,
          workspace_id: WS_B,
          name: 'Test B',
          created_at: T0,
          invitation_seq: 0,
        },
      ],
      assignments: [
        {
          id: 'a5000000-0000-4000-8000-0000000000f1',
          org_id: ORG,
          membership_id: PERSONAS.rec.membership,
          test_id: T1,
          as_role: 'recruiter',
          created_at: T0,
        },
        {
          id: 'a5000000-0000-4000-8000-0000000000f2',
          org_id: ORG,
          membership_id: PERSONAS.rec2.membership,
          test_id: T2,
          as_role: 'recruiter',
          created_at: T0,
        },
        {
          id: 'a5000000-0000-4000-8000-0000000000f3',
          org_id: ORG,
          membership_id: PERSONAS.rev2.membership,
          test_id: T2,
          as_role: 'reviewer',
          created_at: T0,
        },
      ],
    },
    {},
  );
  const ownRecruiterOn = (testId: unknown) =>
    has('recruiter') &&
    (db.tables.assignments ?? []).some(
      (a) => a.test_id === testId && a.membership_id === me.membership && a.as_role === 'recruiter',
    );
  const recruiterArm = (row: Row) =>
    row.org_id === me.org && row.as_role === 'reviewer' && ownRecruiterOn(row.test_id);

  db.hooks.memberships = {
    visible: (row) =>
      row.user_id === me.user ||
      orgWide(row.org_id) ||
      (row.org_id === me.org && live && row.status === 'active'),
  };
  db.hooks.tests = {
    visible: (row) =>
      staff(row.org_id) ||
      (has('reviewer') &&
        (db.tables.assignments ?? []).some(
          (a) => a.test_id === row.id && a.membership_id === me.membership,
        )),
  };
  db.hooks.assignments = {
    visible: (row) => staff(row.org_id) || (has('reviewer') && row.membership_id === me.membership),
    insert: (row, d) => {
      if (!(orgWide(row.org_id) || recruiterArm(row))) throw denied();
      const test = (d.tables.tests ?? []).find(
        (t) => t.id === row.test_id && t.org_id === row.org_id,
      );
      if (test === undefined) throw new RestError(409, '23503');
      const member = (d.tables.memberships ?? []).find(
        (m) => m.id === row.membership_id && m.org_id === row.org_id,
      );
      if (
        member === undefined ||
        member.status !== 'active' ||
        !(member.roles as string[]).includes(String(row.as_role))
      ) {
        throw denied();
      }
      if (
        (d.tables.assignments ?? []).some(
          (a) =>
            a.org_id === row.org_id &&
            a.membership_id === row.membership_id &&
            a.test_id === row.test_id,
        )
      ) {
        throw new RestError(409, '23505');
      }
      return { id: newId(), created_at: '2026-10-17T08:10:00.000+00:00', workspace_id: WS, ...row };
    },
    deletable: (row) => orgWide(row.org_id) || recruiterArm(row),
  };
  return db;
};

export const assignmentsApp = (who: PersonaName, caller: OrgCaller = callerFor(who)) => {
  const db = assignmentsDb(who, caller);
  const app: Hono<{ Bindings: Env }> = createAssignmentsRoutes({
    context: async () => ({ caller, rest: db.rest }),
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
  return { db, call };
};

export const writesOf = (db: FakeDb) =>
  db.calls.filter((c) => c.method !== 'select').map((c) => `${c.method}:${c.table}`);
