// Test doubles for the integrity card module only (rule 1: this module imports no neutral or quality file, so it keeps
// its own fakes). `fakeIntegritySource` answers a small PostgREST subset (select columns, eq/in filters, order, limit)
// over in-memory rows, applies the visibility the RLS policies give an org user (integrity cards and their timeline
// entries only while `reviewed`, §3.2), and records every table and query it is asked for. The fake caller sees two
// orgs, so a missing `org_id` filter shows up as a leak. Synthetic data only.
import type { IntegrityCardRow, IntegrityTimelineEntryRow } from '@trace/shared/contracts/d1';
import type { IntegrityRowSource } from './routes.js';

export const ORG = '11111111-1111-4111-8111-111111111111';
export const ORG_B = '22222222-2222-4222-8222-222222222222';
export const WS = '33333333-3333-4333-8333-333333333333';
export const TEST = '44444444-4444-4444-8444-444444444444';
export const SESSION = '55555555-5555-4555-8555-555555555555';
export const REPORT = '66666666-6666-4666-8666-666666666666';
export const CARD = '77777777-7777-4777-8777-777777777777';
export const RESULT = '88888888-8888-4888-8888-888888888888';
export const RULESET = '99999999-9999-4999-8999-999999999999';
export const BAND_RULES = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const QCARD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const T0 = '2026-10-17T08:00:00+00:00';

export type Row = Record<string, unknown>;

export const integrityCardRow = (patch: Partial<IntegrityCardRow> = {}): IntegrityCardRow => ({
  id: CARD,
  org_id: ORG,
  workspace_id: WS,
  test_id: TEST,
  session_id: SESSION,
  integrity_result_id: RESULT,
  ruleset_version_id: RULESET,
  band_rule_version_id: BAND_RULES,
  rule_table_version: 'd1-v1',
  engine_version: 'band-engine-1',
  review_state: 'reviewed',
  band: 'review',
  evidence_strength: 0.75,
  coverage_permille: 965,
  coverage_floor_permille: 700,
  photo_missing: false,
  computed_at: T0,
  ...patch,
});

let entryN = 0;
export const entryRow = (
  patch: Partial<IntegrityTimelineEntryRow> = {},
): IntegrityTimelineEntryRow => {
  entryN += 1;
  return {
    id: `cccccccc-cccc-4ccc-8ccc-${String(entryN).padStart(12, '0')}`,
    org_id: ORG,
    workspace_id: WS,
    test_id: TEST,
    session_id: SESSION,
    integrity_card_id: CARD,
    position: 1,
    entry_kind: 'flag',
    signal_kind: 'paste',
    family: 'paste',
    rule_id: 'D1-PASTE',
    tier: 'T3',
    offset_ms: 45000,
    count: 1,
    observed: { len: 120 },
    flag_state: 'pending',
    signal_seqs: [7],
    ...patch,
  };
};

export const contextEntry = (
  patch: Partial<IntegrityTimelineEntryRow> = {},
): IntegrityTimelineEntryRow =>
  entryRow({
    entry_kind: 'context',
    signal_kind: 'tab_hidden',
    family: 'focus',
    rule_id: null,
    tier: null,
    flag_state: null,
    observed: { duration_ms: 4000 },
    ...patch,
  });

export const reportRow = (patch: Row = {}): Row => ({
  id: REPORT,
  org_id: ORG,
  workspace_id: WS,
  test_id: TEST,
  session_id: SESSION,
  quality_card_id: QCARD,
  integrity_card_id: CARD,
  created_at: T0,
  ...patch,
});

/** A quality card row as the table holds it; the integrity module may select `meets_cutoff` only. */
export const qualityRow = (meets: boolean, patch: Row = {}): Row => ({
  id: QCARD,
  org_id: ORG,
  workspace_id: WS,
  test_id: TEST,
  session_id: SESSION,
  score: meets ? 72 : 20,
  quality_cutoff: 40,
  meets_cutoff: meets,
  ...patch,
});

export interface Tables {
  reports?: Row[];
  quality_cards?: Row[];
  integrity_cards?: Row[];
  integrity_timeline_entries?: Row[];
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

/** Runs one PostgREST-like select over `rows`. Unknown columns fail like PostgREST (400). */
export const runSelect = (rows: readonly Row[], query: Readonly<Record<string, string>>): Row[] => {
  let out = [...rows];
  for (const [key, value] of Object.entries(query)) {
    if (key === 'select' || key === 'order' || key === 'limit') continue;
    out = out.filter((row) => matches(row, key, value));
  }
  const order = query.order;
  if (order !== undefined) {
    const terms = order.split(',').map((t) => {
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
        if (!(col in row)) throw Object.assign(new Error('rest_failed'), { status: 400 });
        return [col, row[col]];
      }),
    ),
  );
};

/** The RLS view an org user has of the four tables (§3.2): integrity rows only while the card is `reviewed`. */
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

export const fakeIntegritySource = (tables: Tables) => {
  const seen: Seen[] = [];
  let failWith: Error | null = null;
  const source: IntegrityRowSource = {
    async select(_request, _env, table, query) {
      seen.push({ table, query });
      if (failWith !== null) throw failWith;
      const rows = (tables[table as keyof Tables] ?? []).filter((row) =>
        visible(tables, table, row),
      );
      return runSelect(rows, query);
    },
  };
  return {
    source,
    seen,
    /** Every later select throws `err` (an org error from the shared source, or anything else). */
    failNext(err: Error) {
      failWith = err;
    },
  };
};

/** The org error shape the shared CardSource throws (structural; this module never imports it). */
export const orgLikeError = (code: string): Error =>
  Object.assign(new Error(code), { name: 'OrgError', code, status: 404 });

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
