// AT-D10 (assignment part; spec §6.2 assignments rows, D1-14, R-15, L-16): a recruiter assigns and unassigns
// reviewers on a test they are assigned to; owner and admin manage any test; a recruiter on another recruiter's test,
// a reviewer, a hiring manager and another org get 404; every write is as the caller (RLS and the audit trigger
// apply; the audit rows themselves are asserted by supabase/tests/rls_d1_assignments.test.sql).
import { AssignmentListResponse } from '@trace/shared/contracts/d1';
import { describe, expect, it } from 'vitest';
import {
  ORG,
  ORG_B,
  PERSONAS,
  T1,
  T2,
  TB,
  assignmentsApp,
  callerFor,
  writesOf,
} from './assignment.test-helpers.js';
import { REMOVED_MEMBER_LABEL } from './routes.js';

const base = (org: string, test: string) => `/v1/orgs/${org}/tests/${test}/assignments`;
const assignReviewer = (membershipId: string = PERSONAS.rev.membership) => ({
  membershipId,
  asRole: 'reviewer',
});
const NOT_FOUND = '{"error":{"code":"not_found"}}';

describe('a recruiter assigned to the test (L-16)', () => {
  it('lists, assigns a reviewer and unassigns them, as the caller', async () => {
    const { db, call } = assignmentsApp('rec');
    const list = await call('GET', base(ORG, T1));
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toBe('no-store');
    expect(AssignmentListResponse.parse(await list.json()).assignments).toEqual([
      {
        id: 'a5000000-0000-4000-8000-0000000000f1',
        membershipId: PERSONAS.rec.membership,
        asRole: 'recruiter',
        displayName: 'Persona Recruiter',
        createdAt: '2026-10-17T08:00:00.000+00:00',
      },
    ]);

    const created = await call('POST', base(ORG, T1), assignReviewer());
    expect(created.status).toBe(201);
    const after = AssignmentListResponse.parse(await created.json()).assignments;
    expect(after.map((a) => [a.membershipId, a.asRole, a.displayName])).toEqual([
      [PERSONAS.rec.membership, 'recruiter', 'Persona Recruiter'],
      [PERSONAS.rev.membership, 'reviewer', 'Persona Reviewer'],
    ]);
    const insert = db.calls.find((c) => c.method === 'insert');
    expect(insert?.table).toBe('assignments');
    expect(db.tables.assignments?.at(-1)).toMatchObject({
      org_id: ORG,
      membership_id: PERSONAS.rev.membership,
      scope: 'test',
      test_id: T1,
      as_role: 'reviewer',
    });

    const reviewerRow = after[1]?.id ?? '';
    const removed = await call('DELETE', `${base(ORG, T1)}/${reviewerRow}`);
    expect(removed.status).toBe(200);
    expect(AssignmentListResponse.parse(await removed.json()).assignments).toHaveLength(1);
    const del = db.calls.find((c) => c.method === 'remove');
    expect(del?.query).toMatchObject({
      id: `eq.${reviewerRow}`,
      org_id: `eq.${ORG}`,
      test_id: `eq.${T1}`,
      as_role: 'eq.reviewer',
    });
    expect(writesOf(db)).toEqual(['insert:assignments', 'remove:assignments']);
  });

  it('cannot assign any role but reviewer: 404 before any write', async () => {
    const { db, call } = assignmentsApp('rec');
    for (const asRole of ['recruiter', 'admin', 'org_owner']) {
      const res = await call('POST', base(ORG, T1), {
        membershipId: PERSONAS.rec2.membership,
        asRole,
      });
      expect(res.status, asRole).toBe(404);
      expect(await res.text()).toBe(NOT_FOUND);
    }
    expect(writesOf(db)).toEqual([]);
  });

  it('cannot unassign a recruiter row (its own included): 404, nothing deleted', async () => {
    const { db, call } = assignmentsApp('rec');
    const res = await call('DELETE', `${base(ORG, T1)}/a5000000-0000-4000-8000-0000000000f1`);
    expect(res.status).toBe(404);
    expect(db.tables.assignments).toHaveLength(3);
  });

  it('a duplicate is 409; a member who does not hold the role, of another org or removed is 404', async () => {
    const { call } = assignmentsApp('rec');
    expect((await call('POST', base(ORG, T1), assignReviewer())).status).toBe(201);
    const dup = await call('POST', base(ORG, T1), assignReviewer());
    expect(dup.status).toBe(409);
    expect(await dup.text()).toBe('{"error":{"code":"conflict"}}');
    for (const m of [
      PERSONAS.rec2.membership,
      PERSONAS.bRev.membership,
      PERSONAS.gone.membership,
    ]) {
      const res = await call('POST', base(ORG, T1), assignReviewer(m));
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(NOT_FOUND);
    }
  });
});

describe('everyone else gets 404 (L-16, D1-14)', () => {
  it('a recruiter on another recruiter test: list, assign and unassign are 404 with no write', async () => {
    const { db, call } = assignmentsApp('rec');
    for (const [method, path, body] of [
      ['GET', base(ORG, T2), undefined],
      ['POST', base(ORG, T2), assignReviewer()],
      ['DELETE', `${base(ORG, T2)}/a5000000-0000-4000-8000-0000000000f3`, undefined],
    ] as const) {
      const res = await call(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.text()).toBe(NOT_FOUND);
    }
    expect(writesOf(db)).toEqual([]);
    expect(db.tables.assignments).toHaveLength(3);
  });

  it('a reviewer, a hiring manager and an admin of another org are 404 on every route', async () => {
    for (const who of ['rev', 'rev2', 'hm', 'bAdmin'] as const) {
      const { db, call } = assignmentsApp(who);
      for (const [method, path, body] of [
        ['GET', base(ORG, T2), undefined],
        ['POST', base(ORG, T2), assignReviewer()],
        ['DELETE', `${base(ORG, T2)}/a5000000-0000-4000-8000-0000000000f3`, undefined],
      ] as const) {
        const res = await call(method, path, body);
        expect(res.status, `${who} ${method}`).toBe(404);
        expect(await res.text()).toBe(NOT_FOUND);
      }
      expect(writesOf(db)).toEqual([]);
    }
  });

  it('a test of another org through this org path, an unknown test and malformed ids are 404', async () => {
    const { db, call } = assignmentsApp('owner');
    for (const path of [
      base(ORG, TB),
      base(ORG, 'e1000000-0000-4000-8000-000000000099'),
      base(ORG, 'nope'),
      base('nope', T1),
      `${base(ORG, T1)}/nope`,
    ]) {
      const method = path.endsWith('/nope') ? 'DELETE' : 'GET';
      expect((await call(method, path)).status, path).toBe(404);
    }
    expect((await call('POST', base(ORG_B, TB), assignReviewer())).status).toBe(404);
    expect(writesOf(db)).toEqual([]);
  });
});

describe('owner and admin (aal2) manage any test', () => {
  it('assigns a recruiter to another recruiter test and removes any row', async () => {
    const { call } = assignmentsApp('owner');
    const res = await call('POST', base(ORG, T2), {
      membershipId: PERSONAS.rec.membership,
      asRole: 'recruiter',
    });
    expect(res.status).toBe(201);
    const rows = AssignmentListResponse.parse(await res.json()).assignments;
    expect(rows.map((a) => [a.membershipId, a.asRole])).toEqual([
      [PERSONAS.rec2.membership, 'recruiter'],
      [PERSONAS.rev2.membership, 'reviewer'],
      [PERSONAS.rec.membership, 'recruiter'],
    ]);
    const gone = await call('DELETE', `${base(ORG, T2)}/a5000000-0000-4000-8000-0000000000f2`);
    expect(gone.status).toBe(200);
    expect(AssignmentListResponse.parse(await gone.json()).assignments).toHaveLength(2);
  });

  it('an assignment whose member the caller cannot read shows a fixed label, never another field', async () => {
    const { db, call } = assignmentsApp('rec');
    db.tables.assignments?.push({
      id: 'a5000000-0000-4000-8000-0000000000f9',
      org_id: ORG,
      membership_id: PERSONAS.gone.membership,
      test_id: T1,
      as_role: 'reviewer',
      created_at: '2026-10-17T08:20:00.000+00:00',
    });
    const res = await call('GET', base(ORG, T1));
    const rows = AssignmentListResponse.parse(await res.json()).assignments;
    expect(rows.at(-1)?.displayName).toBe(REMOVED_MEMBER_LABEL);
  });
});

describe('assurance level and bad input', () => {
  it('an owner at aal1 and a recruiter signed in by password at aal1 get 403 aal2_required', async () => {
    for (const [who, caller] of [
      ['owner', callerFor('owner', { aal: 'aal1', amr: ['password'] })],
      ['rec', callerFor('rec', { aal: 'aal1', amr: ['password'] })],
    ] as const) {
      const { db, call } = assignmentsApp(who, caller);
      const res = await call('GET', base(ORG, T1));
      expect(res.status, who).toBe(403);
      expect(await res.text()).toBe('{"error":{"code":"aal2_required"}}');
      expect(writesOf(db)).toEqual([]);
    }
  });

  it('a body that breaks the contract is 400 bad_request with nothing written', async () => {
    const { db, call } = assignmentsApp('rec');
    for (const body of [
      {},
      { membershipId: 'nope', asRole: 'reviewer' },
      { membershipId: PERSONAS.rev.membership, asRole: 'hiring_manager' },
      { ...assignReviewer(), scope: 'org' },
      'not json',
    ]) {
      const res = await call('POST', base(ORG, T1), body);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('{"error":{"code":"bad_request"}}');
    }
    expect(writesOf(db)).toEqual([]);
  });
});
