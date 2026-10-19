// SQL of the integrity stage (spec d1 §5.1 row `integrity`, §3.3 note 5; L-3, L-4, L-7, L-28, m-6, n-6), run as
// trace_integrity_worker inside the one transaction the consumer opens. Constant SQL text, bound parameters only,
// jsonb as `$n::text::jsonb` (a text parameter, so no driver re-encodes it), values selected as text or plain
// numbers. The ONLY quality fact read anywhere in integrity/** is public.quality_cards.meets_cutoff (SQL.meetsCutoff; the role's column grant allows nothing else).
import type { SqlTx } from '@trace/shared/jobs';
import type { FlagRow, RuleTableRow, TimelineRow } from './band-call.js';
import type { LoadedSignal } from './load.js';

export type ReviewState = 'reviewed' | 'not_reviewed_below_cutoff' | 'awaiting_quality';

export const SQL = {
  keyExists:
    "select 1 as one from public.idempotency_keys where org_id = $1::uuid and scope = 'integrity_band' and key = $2",
  session:
    'select id::text as id, ruleset_version_id::text as ruleset_version_id, state from public.sessions ' +
    'where org_id = $1::uuid and id = $2::uuid',
  ruleTable:
    'select b.id::text as id, b.version_no::int as version_no, to_jsonb(b.families)::text as families, ' +
    'b.coverage_floor_permille::int as coverage_floor_permille, ' +
    'b.coverage_photo_missing_factor_permille::int as coverage_photo_missing_factor_permille, ' +
    'b.rules::text as rules from public.ruleset_versions as r join integrity.band_rule_versions as b ' +
    'on b.org_id = r.org_id and b.id = r.band_rule_version_id where r.org_id = $1::uuid and r.id = $2::uuid',
  card:
    'select id::text as id, review_state from public.integrity_cards where org_id = $1::uuid ' +
    'and session_id = $2::uuid and ruleset_version_id = $3::uuid',
  meetsCutoff:
    'select meets_cutoff from public.quality_cards where org_id = $1::uuid and session_id = $2::uuid',
  insertSignals:
    'insert into integrity.signals (org_id, session_id, seq, kind, offset_ms, item_position, details) ' +
    'select $1::uuid, $2::uuid, x.seq, x.kind, x.offset_ms, x.item_position, x.details ' +
    'from jsonb_to_recordset($3::text::jsonb) as x(seq int, kind text, offset_ms int, item_position int, details jsonb) ' +
    'on conflict do nothing',
  insertResult:
    'insert into integrity.results (org_id, session_id, ruleset_version_id, band_rule_version_id, engine_version, ' +
    'band, evidence_strength, coverage_permille, coverage_floor_permille, photo_missing, input_hash, computed_at) ' +
    'values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::integrity.band, $7::numeric, $8::smallint, ' +
    '$9::smallint, $10::boolean, $11, now()) on conflict do nothing',
  result:
    'select id::text as id, input_hash, band::text as band from integrity.results where org_id = $1::uuid ' +
    'and session_id = $2::uuid and ruleset_version_id = $3::uuid',
  insertFlags:
    'insert into integrity.flags (org_id, session_id, rule_id, family, tier, severity, untrusted, raw_media, count, ' +
    'first_offset_ms, state, signal_seqs) select $1::uuid, $2::uuid, x.rule_id, x.family, x.tier, x.severity, ' +
    'x.untrusted, x.raw_media, x.count, x.first_offset_ms, $3, x.signal_seqs from jsonb_to_recordset($4::text::jsonb) ' +
    'as x(rule_id text, family text, tier text, severity text, untrusted boolean, raw_media boolean, count int, ' +
    'first_offset_ms int, signal_seqs int[]) on conflict do nothing',
  insertCard:
    'insert into public.integrity_cards (org_id, session_id, integrity_result_id, ruleset_version_id, ' +
    'band_rule_version_id, review_state) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6) ' +
    'on conflict do nothing',
  flip:
    'update public.integrity_cards set review_state = $4 where org_id = $1::uuid and session_id = $2::uuid ' +
    "and ruleset_version_id = $3::uuid and review_state = 'awaiting_quality'",
  insertTimeline:
    'insert into public.integrity_timeline_entries (org_id, session_id, integrity_card_id, position, entry_kind, ' +
    'signal_kind, family, rule_id, tier, offset_ms, count, observed, flag_state, signal_seqs) ' +
    'select $1::uuid, $2::uuid, $3::uuid, x.position, x.entry_kind, x.signal_kind, x.family, x.rule_id, x.tier, ' +
    'x.offset_ms, x.count, x.observed, x.flag_state, x.signal_seqs from jsonb_to_recordset($4::text::jsonb) as ' +
    'x(position smallint, entry_kind text, signal_kind text, family text, rule_id text, tier text, offset_ms int, ' +
    'count smallint, observed jsonb, flag_state text, signal_seqs int[]) on conflict do nothing',
  attach:
    'update public.reports set integrity_card_id = $3::uuid where org_id = $1::uuid and session_id = $2::uuid ' +
    'and integrity_card_id is null',
  pointer:
    'select integrity_card_id::text as integrity_card_id from public.reports where org_id = $1::uuid ' +
    'and session_id = $2::uuid',
  insertKey:
    'insert into public.idempotency_keys (org_id, scope, key, result_ref, expires_at) ' +
    "values ($1::uuid, 'integrity_band', $2, $3, $4::timestamptz + interval '90 days') on conflict do nothing",
} as const;

/** Signal rows per INSERT statement. */
export const SIGNALS_PER_STATEMENT = 5000;

export interface Ids {
  orgId: string;
  sessionId: string;
  rulesetVersionId: string;
}

export const keyExists = async (tx: SqlTx, orgId: string, key: string): Promise<boolean> =>
  (await tx.query(SQL.keyExists, [orgId, key])).length > 0;

export const loadSession = async (
  tx: SqlTx,
  orgId: string,
  sessionId: string,
): Promise<{ id: string; ruleset_version_id: string; state: string } | null> =>
  (
    await tx.query<{ id: string; ruleset_version_id: string; state: string }>(SQL.session, [
      orgId,
      sessionId,
    ])
  )[0] ?? null;

export const loadRuleTable = async (tx: SqlTx, ids: Ids): Promise<RuleTableRow> => {
  const row = (await tx.query<RuleTableRow>(SQL.ruleTable, [ids.orgId, ids.rulesetVersionId]))[0];
  if (row === undefined) throw new Error('integrity_no_rule_table');
  return row;
};

export const readCard = async (
  tx: SqlTx,
  ids: Ids,
): Promise<{ id: string; review_state: ReviewState } | null> =>
  (
    await tx.query<{ id: string; review_state: ReviewState }>(SQL.card, [
      ids.orgId,
      ids.sessionId,
      ids.rulesetVersionId,
    ])
  )[0] ?? null;

/** The rule-6 gate: null while the session has no quality card, else its meets_cutoff. Nothing else of it. */
export const readMeetsCutoff = async (tx: SqlTx, ids: Ids): Promise<boolean | null> => {
  const row = (
    await tx.query<{ meets_cutoff: boolean }>(SQL.meetsCutoff, [ids.orgId, ids.sessionId])
  )[0];
  if (row === undefined) return null;
  if (typeof row.meets_cutoff !== 'boolean') throw new Error('integrity_bad_gate');
  return row.meets_cutoff;
};

export const insertSignals = async (
  tx: SqlTx,
  ids: Ids,
  signals: readonly LoadedSignal[],
): Promise<void> => {
  // In chunks, so no statement parameter grows with the file (memory, C1b note 4).
  for (let i = 0; i < signals.length; i += SIGNALS_PER_STATEMENT) {
    const rows = signals.slice(i, i + SIGNALS_PER_STATEMENT).map((s) => ({
      seq: s.seq,
      kind: s.kind,
      offset_ms: s.offsetMs,
      item_position: s.itemPosition,
      details: s.details,
    }));
    await tx.query(SQL.insertSignals, [ids.orgId, ids.sessionId, JSON.stringify(rows)]);
  }
};

export interface ResultInsert {
  bandRuleVersionId: string;
  engineVersion: string;
  band: string;
  evidenceStrength: string;
  coveragePermille: number;
  coverageFloorPermille: number;
  photoMissing: boolean;
  inputHash: string;
}

/** Inserts the result (or finds the stored one) and returns its id and input hash. */
export const upsertResult = async (
  tx: SqlTx,
  ids: Ids,
  r: ResultInsert,
): Promise<{ id: string; input_hash: string; band: string }> => {
  await tx.query(SQL.insertResult, [
    ids.orgId,
    ids.sessionId,
    ids.rulesetVersionId,
    r.bandRuleVersionId,
    r.engineVersion,
    r.band,
    r.evidenceStrength,
    r.coveragePermille,
    r.coverageFloorPermille,
    r.photoMissing,
    r.inputHash,
  ]);
  return readResult(tx, ids);
};

export const readResult = async (
  tx: SqlTx,
  ids: Ids,
): Promise<{ id: string; input_hash: string; band: string }> => {
  const row = (
    await tx.query<{ id: string; input_hash: string; band: string }>(SQL.result, [
      ids.orgId,
      ids.sessionId,
      ids.rulesetVersionId,
    ])
  )[0];
  if (row === undefined) throw new Error('integrity_result_not_stored');
  return row;
};

export const insertFlags = async (
  tx: SqlTx,
  ids: Ids,
  state: 'pending' | 'not_used',
  flags: readonly FlagRow[],
): Promise<void> => {
  if (flags.length === 0) return;
  await tx.query(SQL.insertFlags, [ids.orgId, ids.sessionId, state, JSON.stringify(flags)]);
};

export const insertCard = async (
  tx: SqlTx,
  ids: Ids,
  resultId: string,
  bandRuleVersionId: string,
  state: ReviewState,
): Promise<{ id: string; review_state: ReviewState }> => {
  await tx.query(SQL.insertCard, [
    ids.orgId,
    ids.sessionId,
    resultId,
    ids.rulesetVersionId,
    bandRuleVersionId,
    state,
  ]);
  const card = await readCard(tx, ids);
  if (card === null) throw new Error('integrity_card_not_stored');
  return card;
};

/** The single UPDATE awaiting_quality -> final state (L-4). */
export const flipCard = async (tx: SqlTx, ids: Ids, state: ReviewState): Promise<void> => {
  await tx.query(SQL.flip, [ids.orgId, ids.sessionId, ids.rulesetVersionId, state]);
  const card = await readCard(tx, ids);
  if (card?.review_state !== state) throw new Error('integrity_flip_failed');
};

export const insertTimeline = async (
  tx: SqlTx,
  ids: Ids,
  cardId: string,
  rows: readonly TimelineRow[],
): Promise<void> => {
  if (rows.length === 0) return;
  await tx.query(SQL.insertTimeline, [ids.orgId, ids.sessionId, cardId, JSON.stringify(rows)]);
};

/** Sets reports.integrity_card_id once (reviewed cards only; the set-once trigger refuses any other). */
export const attachCard = async (tx: SqlTx, ids: Ids, cardId: string): Promise<void> => {
  await tx.query(SQL.attach, [ids.orgId, ids.sessionId, cardId]);
  const row = (
    await tx.query<{ integrity_card_id: string | null }>(SQL.pointer, [ids.orgId, ids.sessionId])
  )[0];
  if (row === undefined) throw new Error('integrity_report_missing');
  if (row.integrity_card_id !== cardId) throw new Error('integrity_pointer_mismatch');
};

export const insertKey = async (
  tx: SqlTx,
  orgId: string,
  key: string,
  resultRef: string,
  submittedAt: string,
): Promise<void> => {
  await tx.query(SQL.insertKey, [orgId, key, resultRef, submittedAt]);
};
