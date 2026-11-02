// Test doubles for the quality card module only (rule 1: this module imports no neutral or integrity file, so it keeps
// its own fakes). `fakeQualitySource` answers a small PostgREST subset (select columns, eq/in filters, order, limit)
// over in-memory rows and records every table and query it is asked for. The fake caller sees two orgs, so a missing
// `org_id` filter shows up as a leak. Synthetic data only.
import type { QualityCardRow } from '@trace/shared/contracts/d1';
import type { QualityRowSource } from './routes.js';

export const ORG = '11111111-1111-4111-8111-111111111111';
export const ORG_B = '22222222-2222-4222-8222-222222222222';
export const WS = '33333333-3333-4333-8333-333333333333';
export const TEST = '44444444-4444-4444-8444-444444444444';
export const SESSION = '55555555-5555-4555-8555-555555555555';
export const REPORT = '66666666-6666-4666-8666-666666666666';
export const QCARD = '77777777-7777-4777-8777-777777777777';
export const QSCORE = '88888888-8888-4888-8888-888888888888';
export const TV = '99999999-9999-4999-8999-999999999999';
export const SEC_MCQ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const SEC_WRITTEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const RUBRIC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const T0 = '2026-10-17T08:00:00+00:00';
export const RUBRIC_SET = 'ab'.repeat(32);

export type Row = Record<string, unknown>;

export const qualityCardRow = (patch: Partial<QualityCardRow> = {}): QualityCardRow => ({
  id: QCARD,
  org_id: ORG,
  workspace_id: WS,
  test_id: TEST,
  session_id: SESSION,
  quality_score_id: QSCORE,
  score: 72,
  section_scores: [
    { sectionId: SEC_MCQ, weight: 1, scoreHundredths: 8000 },
    { sectionId: SEC_WRITTEN, weight: 2, scoreHundredths: 6800 },
  ],
  quality_cutoff: 40,
  meets_cutoff: true,
  scoring_version: 'd1-scoring-v1',
  rubric_set_sha256: RUBRIC_SET,
  rubric_version_ids: [RUBRIC],
  grader_model_id: 'mock-grader-v1',
  grader_adapter_version: 'mock-1',
  test_version_id: TV,
  computed_at: T0,
  ...patch,
});

export const sectionRows = (): Row[] => [
  {
    id: SEC_MCQ,
    org_id: ORG,
    test_version_id: TV,
    position: 1,
    name: 'Part A',
    format: 'mcq',
    weight: 1,
  },
  {
    id: SEC_WRITTEN,
    org_id: ORG,
    test_version_id: TV,
    position: 2,
    name: 'Part B',
    format: 'written',
    weight: 2,
  },
];

export const reportRow = (patch: Row = {}): Row => ({
  id: REPORT,
  org_id: ORG,
  workspace_id: WS,
  test_id: TEST,
  session_id: SESSION,
  quality_card_id: QCARD,
  integrity_card_id: null,
  created_at: T0,
  ...patch,
});

export interface Tables {
  reports?: Row[];
  quality_cards?: Row[];
  sections?: Row[];
}

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
  if (query.limit !== undefined) out = out.slice(0, Number(query.limit));
  const cols = (query.select ?? '*').split(',');
  if (cols[0] === '*') return out.map((row) => ({ ...row }));
  return out.map((row) =>
    Object.fromEntries(
      cols.map((col) => {
        if (!(col in row)) throw Object.assign(new Error('rest_failed'), { status: 400 });
        return [col, row[col]];
      }),
    ),
  );
};

export const fakeQualitySource = (tables: Tables) => {
  const seen: Seen[] = [];
  let failWith: Error | null = null;
  const source: QualityRowSource = {
    async select(_request, _env, table, query) {
      seen.push({ table, query });
      if (failWith !== null) throw failWith;
      const rows = (tables[table as keyof Tables] ?? []).filter(
        (row) => row.org_id === ORG || row.org_id === ORG_B,
      );
      return runSelect(rows, query);
    },
  };
  return {
    source,
    seen,
    failNext(err: Error) {
      failWith = err;
    },
  };
};

/** The org error shape the shared CardSource throws (structural; this module never imports it). */
export const orgLikeError = (code: string, status: number): Error =>
  Object.assign(new Error(code), { name: 'OrgError', code, status });

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
