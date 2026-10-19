// SQL of the quality stage (spec d1 §5.1 row `quality`, §3.3 note 5), run as trace_quality_worker inside the one
// transaction the consumer opens (SET LOCAL ROLE + trace.job_org_id). Constant SQL text, bound parameters only,
// jsonb sent as `$n::text::jsonb` (a text parameter, so no driver re-encodes it), every value selected as text or
// a plain number so the result does not depend on the driver's type parsing. Reads public session and authoring rows; writes quality.grader_runs, quality.scores,
// public.quality_cards, reports.quality_card_id and the `quality_score` key. Nothing here names `integrity`.
import type { SqlTx } from '@trace/shared/jobs';

export const SQL = {
  keyExists:
    "select 1 as one from public.idempotency_keys where org_id = $1::uuid and scope = 'quality_score' and key = $2",
  session:
    'select id::text as id, test_version_id::text as test_version_id, ruleset_version_id::text as ruleset_version_id, ' +
    'state from public.sessions where org_id = $1::uuid and id = $2::uuid',
  cutoff:
    'select quality_cutoff::int as quality_cutoff from public.test_versions where org_id = $1::uuid and id = $2::uuid',
  sections:
    'select id::text as id, position::int as position, weight::text as weight from public.sections ' +
    'where org_id = $1::uuid and test_version_id = $2::uuid order by position',
  items:
    'select id::text as id, section_id::text as section_id, format::text as format, position::int as position, ' +
    'stem, rubric_version_id::text as rubric_version_id from public.item_versions ' +
    'where org_id = $1::uuid and test_version_id = $2::uuid order by position',
  answerKeys:
    "select k.item_version_id::text as item_version_id, k.key ->> 'option_id' as option_id " +
    'from public.item_answer_keys as k join public.item_versions as i ' +
    'on i.org_id = k.org_id and i.id = k.item_version_id ' +
    'where k.org_id = $1::uuid and i.test_version_id = $2::uuid',
  rubrics:
    'select r.id::text as id, r.criteria::text as criteria, r.content_sha256 from public.rubric_versions as r ' +
    'where r.org_id = $1::uuid and r.id in (select i.rubric_version_id from public.item_versions as i ' +
    'where i.org_id = $1::uuid and i.test_version_id = $2::uuid and i.rubric_version_id is not null)',
  served:
    'select id::text as id, item_version_id::text as item_version_id from public.session_items ' +
    'where org_id = $1::uuid and session_id = $2::uuid',
  responses:
    'select session_item_id::text as session_item_id, answer_kind, final_text, final_choice from public.responses ' +
    'where org_id = $1::uuid and session_id = $2::uuid',
  insertRun:
    'insert into quality.grader_runs (org_id, session_id, session_item_id, pass_no, grader_kind, model_id, ' +
    'adapter_version, rubric_version_id, raw_score, criteria, computed_at) ' +
    "values ($1::uuid, $2::uuid, $3::uuid, 1, 'llm', $4, $5, $6::uuid, $7::numeric, $8::text::jsonb, now()) " +
    'on conflict do nothing',
  insertScore:
    'insert into quality.scores (org_id, session_id, test_version_id, score, section_scores, quality_cutoff, ' +
    'meets_cutoff, scoring_version, rubric_set_sha256, rubric_version_ids, grader_model_id, grader_adapter_version, ' +
    'computed_at) values ($1::uuid, $2::uuid, $3::uuid, $4::smallint, $5::text::jsonb, $6::smallint, $7::boolean, $8, $9, ' +
    'array(select jsonb_array_elements_text($10::text::jsonb)::uuid), $11, $12, now()) on conflict do nothing',
  scoreId:
    'select id::text as id from quality.scores where org_id = $1::uuid and session_id = $2::uuid ' +
    'and scoring_version = $3',
  insertCard:
    'insert into public.quality_cards (org_id, session_id, quality_score_id) values ($1::uuid, $2::uuid, $3::uuid) ' +
    'on conflict do nothing',
  cardId:
    'select id::text as id from public.quality_cards where org_id = $1::uuid and session_id = $2::uuid',
  attach:
    'update public.reports set quality_card_id = $3::uuid where org_id = $1::uuid and session_id = $2::uuid ' +
    'and quality_card_id is null',
  pointer:
    'select quality_card_id::text as quality_card_id from public.reports where org_id = $1::uuid ' +
    'and session_id = $2::uuid',
  insertKey:
    'insert into public.idempotency_keys (org_id, scope, key, result_ref, expires_at) ' +
    "values ($1::uuid, 'quality_score', $2, $3, $4::timestamptz + interval '90 days') on conflict do nothing",
} as const;

export interface SessionRow {
  id: string;
  test_version_id: string;
  ruleset_version_id: string;
  state: string;
}
export interface SectionRow {
  id: string;
  position: number;
  weight: string;
}
export interface ItemRow {
  id: string;
  section_id: string;
  format: string;
  position: number;
  stem: string;
  rubric_version_id: string | null;
}
export interface RubricRow {
  id: string;
  criteria: string;
  content_sha256: string;
}
export interface ResponseRow {
  session_item_id: string;
  answer_kind: string;
  final_text: string | null;
  final_choice: string | null;
}

export interface Content {
  cutoff: number;
  sections: SectionRow[];
  items: ItemRow[];
  answerKeys: Map<string, string>;
  rubrics: Map<string, RubricRow>;
}

export interface GraderRunInsert {
  sessionItemId: string;
  modelId: string;
  adapterVersion: string;
  rubricVersionId: string;
  rawScore: string;
  criteriaJson: string;
}

export interface ScoreInsert {
  testVersionId: string;
  score: number;
  sectionScoresJson: string;
  cutoff: number;
  meetsCutoff: boolean;
  scoringVersion: string;
  rubricSetSha256: string;
  rubricVersionIdsJson: string;
  graderModelId: string;
  graderAdapterVersion: string;
}

export const keyExists = async (tx: SqlTx, orgId: string, key: string): Promise<boolean> =>
  (await tx.query(SQL.keyExists, [orgId, key])).length > 0;

export const loadSession = async (
  tx: SqlTx,
  orgId: string,
  sessionId: string,
): Promise<SessionRow | null> =>
  (await tx.query<SessionRow>(SQL.session, [orgId, sessionId]))[0] ?? null;

export const loadContent = async (
  tx: SqlTx,
  orgId: string,
  testVersionId: string,
): Promise<Content> => {
  const cutoffRow = (
    await tx.query<{ quality_cutoff: number | null }>(SQL.cutoff, [orgId, testVersionId])
  )[0];
  if (cutoffRow === undefined || cutoffRow.quality_cutoff === null)
    throw new Error('quality_no_cutoff');
  const sections = await tx.query<SectionRow>(SQL.sections, [orgId, testVersionId]);
  const items = await tx.query<ItemRow>(SQL.items, [orgId, testVersionId]);
  const keys = await tx.query<{ item_version_id: string; option_id: string | null }>(
    SQL.answerKeys,
    [orgId, testVersionId],
  );
  const rubrics = await tx.query<RubricRow>(SQL.rubrics, [orgId, testVersionId]);
  const answerKeys = new Map<string, string>();
  for (const k of keys) {
    if (typeof k.option_id !== 'string') throw new Error('quality_bad_key');
    answerKeys.set(k.item_version_id, k.option_id);
  }
  return {
    cutoff: cutoffRow.quality_cutoff,
    sections,
    items,
    answerKeys,
    rubrics: new Map(rubrics.map((r) => [r.id, r])),
  };
};

/** The session's answers by item version id (an item without a row was not answered). */
export const loadAnswers = async (
  tx: SqlTx,
  orgId: string,
  sessionId: string,
): Promise<{ servedItem: Map<string, string>; answers: Map<string, ResponseRow> }> => {
  const served = await tx.query<{ id: string; item_version_id: string }>(SQL.served, [
    orgId,
    sessionId,
  ]);
  const responses = await tx.query<ResponseRow>(SQL.responses, [orgId, sessionId]);
  const itemOf = new Map(served.map((s) => [s.id, s.item_version_id]));
  const servedItem = new Map(served.map((s) => [s.item_version_id, s.id]));
  const answers = new Map<string, ResponseRow>();
  for (const r of responses) {
    const itemVersionId = itemOf.get(r.session_item_id);
    if (itemVersionId === undefined) throw new Error('quality_bad_response');
    answers.set(itemVersionId, r);
  }
  return { servedItem, answers };
};

export const insertGraderRun = async (
  tx: SqlTx,
  orgId: string,
  sessionId: string,
  run: GraderRunInsert,
): Promise<void> => {
  await tx.query(SQL.insertRun, [
    orgId,
    sessionId,
    run.sessionItemId,
    run.modelId,
    run.adapterVersion,
    run.rubricVersionId,
    run.rawScore,
    run.criteriaJson,
  ]);
};

/** Inserts the score (or finds the one a replay stored) and returns its id. */
export const upsertScore = async (
  tx: SqlTx,
  orgId: string,
  sessionId: string,
  s: ScoreInsert,
): Promise<string> => {
  await tx.query(SQL.insertScore, [
    orgId,
    sessionId,
    s.testVersionId,
    s.score,
    s.sectionScoresJson,
    s.cutoff,
    s.meetsCutoff,
    s.scoringVersion,
    s.rubricSetSha256,
    s.rubricVersionIdsJson,
    s.graderModelId,
    s.graderAdapterVersion,
  ]);
  const row = (
    await tx.query<{ id: string }>(SQL.scoreId, [orgId, sessionId, s.scoringVersion])
  )[0];
  if (row === undefined) throw new Error('quality_score_not_stored');
  return row.id;
};

/** Inserts the public card (filled from the score by its trigger) and returns its id. */
export const upsertCard = async (
  tx: SqlTx,
  orgId: string,
  sessionId: string,
  scoreId: string,
): Promise<string> => {
  await tx.query(SQL.insertCard, [orgId, sessionId, scoreId]);
  const row = (await tx.query<{ id: string }>(SQL.cardId, [orgId, sessionId]))[0];
  if (row === undefined) throw new Error('quality_card_not_stored');
  return row.id;
};

/** Sets reports.quality_card_id once (null -> card); a pointer to another card is an error. */
export const attachCard = async (
  tx: SqlTx,
  orgId: string,
  sessionId: string,
  cardId: string,
): Promise<void> => {
  await tx.query(SQL.attach, [orgId, sessionId, cardId]);
  const row = (
    await tx.query<{ quality_card_id: string | null }>(SQL.pointer, [orgId, sessionId])
  )[0];
  if (row === undefined) throw new Error('quality_report_missing');
  if (row.quality_card_id !== cardId) throw new Error('quality_pointer_mismatch');
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
