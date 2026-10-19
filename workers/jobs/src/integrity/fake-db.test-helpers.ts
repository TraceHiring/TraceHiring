// In-memory stand-in for the integrity stage's SQL (test only). Each constant statement of ./store.ts has a handler
// over plain rows that keeps what the real schema enforces for this stage (migration d1_results): unique keys with
// ON CONFLICT DO NOTHING, the card filled from its result, the card guard (L-4, L-28: awaiting needs no quality card
// and no flags; reviewed needs meets_cutoff and pending flags; below-cutoff needs not_used flags; one forward
// UPDATE), the flag guard (needs the quality card, not_used iff below the cutoff, none once the card is final), the
// timeline guard (reviewed cards only) and the set-once pointer that only takes a reviewed card. The real SQL is
// proven against Postgres in db-test/. Rule 1: of quality data this fake exposes meets_cutoff only.
import type { SqlParam, SqlTx } from '@trace/shared/jobs';
import { SQL } from './store.js';

export type Row = Record<string, unknown>;
export interface FakeDb {
  tables: Record<string, Row[]>;
  jobOrg: string | null;
  seq: number;
}
export type Handler = (db: FakeDb, p: readonly SqlParam[]) => Row[];

export const newDb = (): FakeDb => ({ tables: {}, jobOrg: null, seq: 0 });

export const fakeId = (db: FakeDb): string => {
  db.seq += 1;
  return `2a9f6d3b-8c1e-4b7a-9f20-6e4c8d${db.seq.toString(16).padStart(6, '0')}`;
};

export const table = (db: FakeDb, name: string): Row[] => (db.tables[name] ??= []);

const visible = (db: FakeDb, name: string, org: unknown): Row[] => {
  if (db.jobOrg === null || org !== db.jobOrg) return [];
  return table(db, name).filter((r) => r['org_id'] === org);
};

const guard = (reason: string): never => {
  throw new Error(`TRACE_GUARD: ${reason}`);
};

const insertUnique = (
  db: FakeDb,
  name: string,
  row: Row,
  keys: readonly (readonly string[])[],
): void => {
  if (db.jobOrg === null || row['org_id'] !== db.jobOrg) throw new Error('42501 rls');
  const rows = table(db, name);
  if (!keys.some((k) => rows.some((r) => k.every((c) => r[c] === row[c])))) rows.push(row);
};

const quality = (db: FakeDb, org: unknown, session: unknown): Row | undefined =>
  table(db, 'quality_cards').find((r) => r['org_id'] === org && r['session_id'] === session);

const flagsOf = (db: FakeDb, org: unknown, session: unknown): Row[] =>
  table(db, 'flags').filter((r) => r['org_id'] === org && r['session_id'] === session);

/** integrity_cards_guard: the state is tied to meets_cutoff and the flag states; the band to the flags. */
const checkCard = (db: FakeDb, card: Row): void => {
  const q = quality(db, card['org_id'], card['session_id']);
  const flags = flagsOf(db, card['org_id'], card['session_id']);
  const state = card['review_state'];
  if (state === 'awaiting_quality') {
    if (q !== undefined || flags.length > 0)
      guard('awaiting_quality needs no quality card and no flags');
    return;
  }
  if (state === 'reviewed') {
    if (q?.['meets_cutoff'] !== true || flags.some((f) => f['state'] !== 'pending'))
      guard('reviewed');
  } else if (state === 'not_reviewed_below_cutoff') {
    if (q?.['meets_cutoff'] !== false || flags.some((f) => f['state'] !== 'not_used'))
      guard('below');
  } else {
    guard('unknown state');
  }
  const strong = flags.some(
    (f) => f['tier'] !== 'T3' || f['untrusted'] === true || f['raw_media'] === true,
  );
  const review =
    flags.some(
      (f) => f['tier'] === 'T3' && (f['severity'] === 'medium' || f['severity'] === 'hard'),
    ) || new Set(flags.filter((f) => f['tier'] === 'T3').map((f) => f['family'])).size >= 2;
  const band = card['band'];
  if (band === 'strong_concern' && !strong) guard('strong_concern needs a strong flag');
  if (band === 'review' && (strong || !review)) guard('review needs a review flag');
  if ((band === 'clear' || band === 'insufficient_evidence') && (strong || review))
    guard('band too low');
};

export const integrityHandlers: Record<string, Handler> = {
  [SQL.keyExists]: (db, [org, key]) =>
    visible(db, 'idempotency_keys', org)
      .filter((r) => r['scope'] === 'integrity_band' && r['key'] === key)
      .map(() => ({ one: 1 })),
  // The advisory lock: the fake runs one transaction at a time, so it only records the call.
  [SQL.lockKey]: () => [{ one: 1 }],
  [SQL.session]: (db, [org, id]) =>
    visible(db, 'sessions', org)
      .filter((r) => r['id'] === id)
      .map((r) => ({
        id: r['id'],
        ruleset_version_id: r['ruleset_version_id'],
        state: r['state'],
      })),
  [SQL.ruleTable]: (db, [org, rs]) => {
    const r = visible(db, 'ruleset_versions', org).find((x) => x['id'] === rs);
    const b = visible(db, 'band_rule_versions', org).find(
      (x) => x['id'] === r?.['band_rule_version_id'],
    );
    if (b === undefined) return [];
    return [
      {
        id: b['id'],
        version_no: b['version_no'],
        families: JSON.stringify(b['families']),
        coverage_floor_permille: b['coverage_floor_permille'],
        coverage_photo_missing_factor_permille: b['coverage_photo_missing_factor_permille'],
        rules: JSON.stringify(b['rules']),
      },
    ];
  },
  [SQL.card]: (db, [org, s, rs]) =>
    visible(db, 'integrity_cards', org)
      .filter((r) => r['session_id'] === s && r['ruleset_version_id'] === rs)
      .map((r) => ({ id: r['id'], review_state: r['review_state'] })),
  [SQL.meetsCutoff]: (db, [org, s]) =>
    visible(db, 'quality_cards', org)
      .filter((r) => r['session_id'] === s)
      .map((r) => ({ meets_cutoff: r['meets_cutoff'] })),
  [SQL.insertSignals]: (db, [org, s, rows]) => {
    for (const x of JSON.parse(String(rows)) as Row[]) {
      insertUnique(db, 'signals', { id: fakeId(db), org_id: org, session_id: s, ...x }, [
        ['org_id', 'session_id', 'seq'],
      ]);
    }
    return [];
  },
  [SQL.insertResult]: (db, p) => {
    const [org, s, rs, brv, engine, band, strength, coverage, floor, photo, hash] = p;
    if (band === 'clear' && Number(coverage) < Number(floor))
      throw new Error('23514 clear on thin coverage');
    insertUnique(
      db,
      'results',
      {
        id: fakeId(db),
        org_id: org,
        session_id: s,
        ruleset_version_id: rs,
        band_rule_version_id: brv,
        engine_version: engine,
        band,
        evidence_strength: strength,
        coverage_permille: coverage,
        coverage_floor_permille: floor,
        photo_missing: photo,
        input_hash: hash,
      },
      [['org_id', 'session_id', 'ruleset_version_id']],
    );
    return [];
  },
  [SQL.result]: (db, [org, s, rs]) =>
    visible(db, 'results', org)
      .filter((r) => r['session_id'] === s && r['ruleset_version_id'] === rs)
      .map((r) => ({ id: r['id'], input_hash: r['input_hash'], band: r['band'] })),
  [SQL.insertFlags]: (db, [org, s, state, rows]) => {
    const card = table(db, 'integrity_cards').find(
      (c) => c['org_id'] === org && c['session_id'] === s,
    );
    if (card !== undefined && card['review_state'] !== 'awaiting_quality') {
      guard('no flag is added once the integrity card is final');
    }
    const q = quality(db, org, s);
    if (q === undefined) guard('a flag needs the session quality card');
    if ((state === 'not_used') !== (q?.['meets_cutoff'] === false))
      guard('not_used iff below the cutoff');
    for (const x of JSON.parse(String(rows)) as Row[]) {
      insertUnique(db, 'flags', { id: fakeId(db), org_id: org, session_id: s, state, ...x }, [
        ['org_id', 'session_id', 'rule_id'],
      ]);
    }
    return [];
  },
  [SQL.insertCard]: (db, [org, s, resultId, , , state]) => {
    const result = table(db, 'results').find((r) => r['id'] === resultId && r['session_id'] === s);
    if (result === undefined) throw new Error('23503 result');
    const card: Row = {
      id: fakeId(db),
      org_id: org,
      session_id: s,
      integrity_result_id: resultId,
      ruleset_version_id: result['ruleset_version_id'],
      band_rule_version_id: result['band_rule_version_id'],
      rule_table_version: 'd1-v1',
      engine_version: result['engine_version'],
      review_state: state,
      band: result['band'],
      evidence_strength: result['evidence_strength'],
      coverage_permille: result['coverage_permille'],
      coverage_floor_permille: result['coverage_floor_permille'],
      photo_missing: result['photo_missing'],
    };
    checkCard(db, card); // the guard runs before ON CONFLICT
    insertUnique(db, 'integrity_cards', card, [['org_id', 'session_id', 'ruleset_version_id']]);
    return [];
  },
  [SQL.flip]: (db, [org, s, rs, state]) => {
    for (const card of visible(db, 'integrity_cards', org)) {
      if (card['session_id'] !== s || card['ruleset_version_id'] !== rs) continue;
      if (card['review_state'] !== 'awaiting_quality') continue;
      if (state === 'awaiting_quality') guard('review_state moves once');
      const next = { ...card, review_state: state };
      checkCard(db, next);
      card['review_state'] = state;
    }
    return [];
  },
  [SQL.insertTimeline]: (db, [org, s, cardId, rows]) => {
    const card = table(db, 'integrity_cards').find(
      (c) => c['id'] === cardId && c['session_id'] === s,
    );
    if (card?.['review_state'] !== 'reviewed')
      guard('timeline entries exist only for a reviewed card');
    for (const x of JSON.parse(String(rows)) as Row[]) {
      if (x['flag_state'] !== null && x['flag_state'] !== 'pending')
        throw new Error('23514 flag_state');
      if ((x['signal_kind'] === 'connectivity_gap') !== (x['family'] === 'connectivity')) {
        throw new Error('23514 connectivity');
      }
      insertUnique(
        db,
        'timeline',
        { id: fakeId(db), org_id: org, session_id: s, integrity_card_id: cardId, ...x },
        [['org_id', 'integrity_card_id', 'position']],
      );
    }
    return [];
  },
  [SQL.attach]: (db, [org, s, cardId]) => {
    for (const r of visible(db, 'reports', org)) {
      if (r['session_id'] !== s || r['integrity_card_id'] != null) continue;
      const card = table(db, 'integrity_cards').find((c) => c['id'] === cardId);
      if (card !== undefined && card['review_state'] !== 'reviewed')
        guard('only a reviewed card is attached');
      r['integrity_card_id'] = cardId;
    }
    return [];
  },
  [SQL.pointer]: (db, [org, s]) =>
    visible(db, 'reports', org)
      .filter((r) => r['session_id'] === s)
      .map((r) => ({ integrity_card_id: r['integrity_card_id'] ?? null })),
  [SQL.insertKey]: (db, [org, key, ref]) => {
    insertUnique(
      db,
      'idempotency_keys',
      { org_id: org, scope: 'integrity_band', key, result_ref: ref },
      [['org_id', 'scope', 'key']],
    );
    return [];
  },
};

export const fakeTx = (db: FakeDb, handlers: Record<string, Handler>, log?: string[]): SqlTx => ({
  query: <R extends object>(text: string, params: readonly SqlParam[] = []): Promise<R[]> => {
    const h = handlers[text];
    if (h === undefined) return Promise.reject(new Error('fake: unknown statement'));
    log?.push(text);
    try {
      return Promise.resolve(h(db, params) as R[]);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error('fake'));
    }
  },
});

/** Runs `fn` directly on the shared tables (two such runs interleave like two concurrent connections). */
export const shared = <T>(
  db: FakeDb,
  org: string,
  handlers: Record<string, Handler>,
  fn: (tx: SqlTx) => Promise<T>,
): Promise<T> => {
  db.jobOrg = org;
  return fn(fakeTx(db, handlers));
};

/** One transaction: a copy of the tables replaces the originals only if `fn` resolves. */
export const inTx = async <T>(
  db: FakeDb,
  org: string,
  handlers: Record<string, Handler>,
  fn: (tx: SqlTx) => Promise<T>,
  log?: string[],
): Promise<T> => {
  const work: FakeDb = { tables: structuredClone(db.tables), jobOrg: org, seq: db.seq };
  const out = await fn(fakeTx(work, handlers, log));
  db.tables = work.tables;
  db.seq = work.seq;
  return out;
};
