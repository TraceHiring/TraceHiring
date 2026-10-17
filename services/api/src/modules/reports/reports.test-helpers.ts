// Test doubles for the reports module: a fake PostgREST `Rest` over in-memory rows (select columns, eq/in filters,
// order, limit) that applies the visibility RLS gives the fake caller (§3.3: integrity cards and timeline entries only
// while `reviewed`; the caller is in two orgs, so a missing `org_id` filter shows up as a leak) and records every
// table and query. Synthetic data only: labels are `Candidate N`, contacts `@example.test`.
import type { OrgCaller, OrgDeps, Rest } from '../tests/org-context.js';

export const ORG = '11111111-1111-4111-8111-111111111111';
export const ORG_B = '22222222-2222-4222-8222-222222222222';
export const WS = '33333333-3333-4333-8333-333333333333';
export const TEST = '44444444-4444-4444-8444-444444444444';
export const TEST_2 = '44444444-4444-4444-8444-000000000002';
export const TV = '55555555-5555-4555-8555-555555555555';
export const RULESET = '99999999-9999-4999-8999-999999999999';
export const USER = '0f000000-0000-4000-8000-000000000001';
export const MEMBERSHIP = '0e000000-0000-4000-8000-000000000001';
export const T0 = '2026-10-17T08:00:00+00:00';

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

const hex = (n: number, len: number) => n.toString(16).padStart(len, '0');
export const uuidOf = (prefix: string, n: number) =>
  `${prefix}${prefix}${prefix}${prefix}${prefix}${prefix}${prefix}${prefix}-0000-4000-8000-${hex(n, 12)}`;

export const reportId = (n: number) => uuidOf('a', n);
export const sessionId = (n: number) => uuidOf('b', n);
export const invitationId = (n: number) => uuidOf('c', n);
export const consentId = (n: number) => uuidOf('d', n);
export const qcardId = (n: number) => uuidOf('e', n);
export const icardId = (n: number) => uuidOf('f', n);

export interface CandidateSpec {
  n: number;
  /** null: no quality card yet. */
  score: number | null;
  cutoff?: number;
  org?: string;
  test?: string;
  submittedAt?: string | null;
  /** The integrity card's review state, when one exists. */
  integrity?: 'reviewed' | 'not_reviewed_below_cutoff' | 'awaiting_quality';
  receiptRef?: string;
}

/** One submitted candidate across every table a report touches (both card kinds, for leak checks). */
export const candidateRows = (spec: CandidateSpec): Tables => {
  const org = spec.org ?? ORG;
  const test = spec.test ?? TEST;
  const cutoff = spec.cutoff ?? 40;
  const sid = sessionId(spec.n);
  const qc = spec.score === null ? null : qcardId(spec.n);
  const ic = spec.integrity === 'reviewed' ? icardId(spec.n) : null;
  const tables: Tables = {
    reports: [
      {
        id: reportId(spec.n),
        org_id: org,
        workspace_id: WS,
        test_id: test,
        session_id: sid,
        quality_card_id: qc,
        integrity_card_id: ic,
        created_at: spec.submittedAt ?? `2026-10-17T08:${String(spec.n).padStart(2, '0')}:00+00:00`,
      },
    ],
    sessions: [
      {
        id: sid,
        org_id: org,
        workspace_id: WS,
        test_id: test,
        test_version_id: TV,
        ruleset_version_id: RULESET,
        invitation_id: invitationId(spec.n),
        consent_id: consentId(spec.n),
        state: 'submitted',
        submitted_at:
          spec.submittedAt === undefined
            ? `2026-10-17T08:${String(spec.n).padStart(2, '0')}:00+00:00`
            : spec.submittedAt,
        receipt_ref: spec.receiptRef ?? `ABCD${String(1000 + spec.n)}`,
      },
    ],
    invitations: [
      {
        id: invitationId(spec.n),
        org_id: org,
        workspace_id: WS,
        test_id: test,
        candidate_label: `Candidate ${String(spec.n)}`,
        contact_email: `cand${String(spec.n)}@example.test`,
        status: 'submitted',
      },
    ],
    consents: [
      {
        id: consentId(spec.n),
        org_id: org,
        invitation_id: invitationId(spec.n),
        rendered_sha256: 'bb'.repeat(32),
      },
    ],
    quality_cards:
      spec.score === null
        ? []
        : [
            {
              id: qc,
              org_id: org,
              workspace_id: WS,
              test_id: test,
              session_id: sid,
              score: spec.score,
              section_scores: [],
              quality_cutoff: cutoff,
              meets_cutoff: spec.score >= cutoff,
              scoring_version: 'd1-scoring-v1',
              rubric_set_sha256: 'ab'.repeat(32),
              grader_model_id: 'mock-grader-v1',
              test_version_id: TV,
            },
          ],
    integrity_cards:
      spec.integrity === undefined
        ? []
        : [
            {
              id: icardId(spec.n),
              org_id: org,
              session_id: sid,
              review_state: spec.integrity,
              band: 'strong_concern',
              rule_table_version: 'd1-v1',
            },
          ],
  };
  return tables;
};

export const baseTables = (): Tables => ({
  tests: [
    { id: TEST, org_id: ORG, workspace_id: WS, name: 'Sample test' },
    { id: TEST_2, org_id: ORG, workspace_id: WS, name: 'Second test' },
  ],
  test_versions: [
    { id: TV, org_id: ORG, test_id: TEST, version_no: 1, status: 'published', quality_cutoff: 40 },
  ],
  memberships: [
    { id: MEMBERSHIP, org_id: ORG, user_id: USER, roles: ['reviewer'], status: 'active' },
  ],
  assignments: [
    {
      id: uuidOf('9', 1),
      org_id: ORG,
      membership_id: MEMBERSHIP,
      test_id: TEST,
      as_role: 'reviewer',
    },
  ],
});

export const merge = (...parts: Tables[]): Tables => {
  const out: Tables = {};
  for (const part of parts) {
    for (const [table, rows] of Object.entries(part)) out[table] = [...(out[table] ?? []), ...rows];
  }
  return out;
};

export interface Seen {
  table: string;
  query: Readonly<Record<string, string>>;
}

const matches = (row: Row, key: string, filter: string): boolean => {
  const value = row[key];
  const text = value === null || value === undefined ? 'null' : String(value);
  if (filter.startsWith('eq.')) return text === filter.slice(3);
  if (filter.startsWith('neq.')) return text !== filter.slice(4);
  if (filter.startsWith('in.(') && filter.endsWith(')')) {
    return filter.slice(4, -1).split(',').includes(text);
  }
  throw new Error(`fake: unsupported filter ${key}`);
};

const runSelect = (rows: readonly Row[], query: Readonly<Record<string, string>>): Row[] => {
  let out = [...rows];
  for (const [key, value] of Object.entries(query)) {
    if (key === 'select' || key === 'order' || key === 'limit') continue;
    out = out.filter((row) => matches(row, key, value));
  }
  if (query.order !== undefined) {
    const terms = query.order.split(',').map((t) => {
      const [col, dir] = t.split('.');
      return { col: col ?? '', desc: dir === 'desc' };
    });
    out.sort((a, b) => {
      for (const { col, desc } of terms) {
        const x = a[col] as string | number;
        const y = b[col] as string | number;
        if (x < y) return desc ? 1 : -1;
        if (x > y) return desc ? -1 : 1;
      }
      return 0;
    });
  }
  if (query.limit !== undefined) out = out.slice(0, Number(query.limit));
  const cols = (query.select ?? '*').split(',');
  if (cols[0] === '*') return out.map((row) => ({ ...row }));
  return out.map((row) =>
    Object.fromEntries(
      cols.map((col) => {
        if (!(col in row)) throw new Error(`fake: unknown column ${col}`);
        return [col, row[col]];
      }),
    ),
  );
};

const visible = (tables: Tables, table: string, row: Row): boolean => {
  if (row.org_id !== ORG && row.org_id !== ORG_B) return false;
  if (table === 'integrity_cards') return row.review_state === 'reviewed';
  if (table === 'integrity_timeline_entries') {
    return (tables.integrity_cards ?? []).some(
      (c) => c.id === row.integrity_card_id && c.review_state === 'reviewed',
    );
  }
  return true;
};

export const fakeRest = (tables: Tables) => {
  const seen: Seen[] = [];
  const refuse = (): never => {
    throw new Error('fake: the reports module never writes');
  };
  const rest: Rest = {
    async select<T>(table: string, query: Readonly<Record<string, string>>): Promise<T[]> {
      seen.push({ table, query });
      const rows = (tables[table] ?? []).filter((row) => visible(tables, table, row));
      return Promise.resolve(runSelect(rows, query) as T[]);
    },
    insert: refuse,
    update: refuse,
    remove: refuse,
  };
  return { rest, seen };
};

export const callerOf = (aal: 'aal1' | 'aal2' = 'aal2'): OrgCaller => ({
  userId: USER,
  aal,
  amr: aal === 'aal2' ? ['password', 'totp'] : ['otp'],
  jwt: 'h.p.s',
});

export const fakeDeps = (tables: Tables, caller: OrgCaller = callerOf()) => {
  const { rest, seen } = fakeRest(tables);
  const deps: OrgDeps = { context: () => Promise.resolve({ caller, rest }) };
  return { deps, seen };
};

/** Every key of a JSON value, at any depth. */
export const keysDeep = (value: unknown, out: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const v of value) keysDeep(v, out);
  } else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
};

export const ENV = {} as Env;
