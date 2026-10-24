// Quality stage (spec d1 §5.1 row `quality`, §5.4; D1-8; L-5, L-6, m-6, n-4), as trace_quality_worker in the one
// transaction the consumer opens and commits. Reads the session's responses and the pinned test version's sections,
// items, keys, rubrics and cutoff; grades written answers through the injected LlmGrader; then writes grader runs,
// the score, the public quality card, reports.quality_card_id and the `quality_score` key, all in this transaction.
// Package v2 (spec m1 R5-19, R5-47): inline sections as D1; a pool section counts its draw_count slots, filled from
// the candidate's own session_items, with keys loaded through them (the served variant's key for a parameterised
// item) and options scored by id (./v2.ts). Before anything is scored, the message's served positions and pool section
// ids are checked against the pinned version again (R5-59 a, ./layout.ts; the mirror checked them before it
// stored anything, R5-62 b, so this is defence in depth against a different body for the same session). The
// arithmetic is unchanged; a v2 session records SCORING_VERSION_V2 (`m1-scoring-v1`), a v1 session SCORING_VERSION
// (`d1-scoring-v1`). Each path requires the version's package to be its own (v1 = 1, v2 = 2), else
// `quality_bad_package`.
// Rule 1: nothing here reads or receives integrity data; the score function has no such parameter.
// Errors are constant codes; no answer text, score or id reaches a thrown message.
import type { SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import { canonicalJson } from '@trace/shared/canonical-json';
import { QualityCardRow } from '@trace/shared/contracts/d1';
import { jobKey, type SqlTx } from '@trace/shared/jobs';
import type { LlmGrader } from '@trace/vendors';
import { scoreMcq } from './mcq.js';
import {
  SCORING_VERSION,
  SCORING_VERSION_V2,
  computeAnswerQuality,
  meetsCutoff,
  parseWeight,
} from './score.js';
import {
  attachCard,
  insertGraderRun,
  insertKey,
  keyExists,
  loadAnswers,
  loadContent,
  loadContentV2,
  loadSession,
  upsertCard,
  upsertScore,
  type Content,
  type GraderRunInsert,
  type ItemRow,
  type RubricRow,
  type SectionRow,
} from './store.js';
import { QUALITY_LAYOUT_CODES, checkServedLayout, type LayoutMessage } from './layout.js';
import { mcqKeyOf, planScoredItems, type PlanEntry, type PlanItem } from './v2.js';
import { gradeWritten, rubricSnapshot } from './written.js';

export interface QualityDeps {
  tx: SqlTx;
  grader: LlmGrader;
}

/** The grader names recorded when no written answer was graded (an MCQ-only or all-empty session). */
export const NO_GRADER = 'none';

const fail = (code: string): never => {
  throw new Error(code);
};

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');

export const sha256Hex = async (text: string): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

/**
 * rubric_set_sha256 (n-4): SHA-256 of canonicalJson of the used rubric versions' stored content_sha256 values,
 * sorted ascending. The stored hashes are opaque to the job: copied, never recomputed.
 */
export const rubricSetSha256 = (contentHashes: readonly string[]): Promise<string> =>
  sha256Hex(canonicalJson([...contentHashes].sort()));

const SectionScores = QualityCardRow.shape.section_scores;

/** What the scoring loop reads: the sections with weights, the scored entries in order, keys and rubrics. */
interface ScoredSet {
  cutoff: number;
  sections: readonly SectionRow[];
  entries: readonly PlanEntry[];
  answerKeys: ReadonlyMap<string, string>;
  variantKeys: ReadonlyMap<string, string>;
  rubrics: ReadonlyMap<string, RubricRow>;
}

const planItem = (i: ItemRow): PlanItem => ({
  itemVersionId: i.id,
  sectionId: i.section_id,
  format: i.format,
  stem: i.stem,
  rubricVersionId: i.rubric_version_id,
  variantId: null,
});

/** Package v1 (D1, unchanged): every item of the pinned version, in the D1 query's order, keyed by item version. */
const scoredSetV1 = (content: Content): ScoredSet => ({
  cutoff: content.cutoff,
  sections: content.sections,
  entries: content.items.map((i) => ({ id: i.id, sectionId: i.section_id, item: planItem(i) })),
  answerKeys: content.answerKeys,
  variantKeys: new Map(),
  rubrics: content.rubrics,
});

/**
 * Package v2 (spec m1 R5-19, R5-47): inline sections as D1, pool sections by draw_count slots. The message's layout is
 * checked against the version first (R5-59 a), so nothing is scored from a served row out of place.
 */
const scoredSetV2 = async (
  tx: SqlTx,
  orgId: string,
  testVersionId: string,
  sessionId: string,
  message: LayoutMessage,
): Promise<ScoredSet> => {
  const content = await loadContentV2(tx, orgId, testVersionId, sessionId);
  const sections = content.sections.map((s) => ({ id: s.id, drawCount: s.draw_count }));
  checkServedLayout(sections, content.inline.map(planItem), message, QUALITY_LAYOUT_CODES);
  const entries = planScoredItems(
    sections,
    content.inline.map(planItem),
    content.drawn.map((d) => ({
      itemVersionId: d.item_version_id,
      sectionId: d.section_id,
      format: d.format,
      stem: d.stem,
      rubricVersionId: d.rubric_version_id,
      variantId: d.item_variant_id,
      position: d.position,
    })),
  );
  return {
    cutoff: content.cutoff,
    sections: content.sections,
    entries,
    answerKeys: content.answerKeys,
    variantKeys: content.variantKeys,
    rubrics: content.rubrics,
  };
};

const runQualityUnsafe = async (
  message: SessionMirrorMessage,
  deps: QualityDeps,
): Promise<void> => {
  const { tx, grader } = deps;
  const orgId = message.orgId;
  const sessionId = message.sessionId;
  const key = jobKey(sessionId, 'quality_score', message.rulesetVersionId);
  if (await keyExists(tx, orgId, key)) return;

  const session = await loadSession(tx, orgId, sessionId);
  if (session === null) return fail('quality_session_missing');
  if (
    session.test_version_id !== message.testVersionId ||
    session.ruleset_version_id !== message.rulesetVersionId
  ) {
    return fail('quality_pin_mismatch');
  }
  if (session.state === 'in_progress') return fail('quality_session_open');

  const content =
    message.v === 2
      ? await scoredSetV2(tx, orgId, session.test_version_id, sessionId, message)
      : scoredSetV1(await loadContent(tx, orgId, session.test_version_id));
  const { servedItem, answers } = await loadAnswers(tx, orgId, sessionId);

  // v1: every item of the pinned version counts. v2 (R5-19): inline sections as D1, pool sections by their
  // draw_count slots. An item never served or never answered, and an empty slot, scores 0.
  const itemScores: { id: string; sectionId: string; score: number }[] = [];
  const runs: GraderRunInsert[] = [];
  const usedRubrics = new Map<string, string>();
  for (const entry of content.entries) {
    const item = entry.item;
    if (item === null) {
      itemScores.push({ id: entry.id, sectionId: entry.sectionId, score: 0 });
      continue;
    }
    const answer = answers.get(item.itemVersionId);
    let score = 0;
    if (item.format === 'mcq') {
      const correct = mcqKeyOf(item, content.answerKeys, content.variantKeys);
      if (answer !== undefined && answer.answer_kind !== 'choice')
        return fail('quality_bad_response');
      // By option id: the served option order never changes the score.
      score = scoreMcq(answer?.final_choice, correct);
    } else if (item.format === 'written') {
      const rubricId = item.rubricVersionId;
      const rubric = rubricId === null ? undefined : content.rubrics.get(rubricId);
      if (rubricId === null || rubric === undefined) return fail('quality_bad_rubric');
      usedRubrics.set(rubricId, rubric.content_sha256);
      if (answer !== undefined && answer.answer_kind !== 'text')
        return fail('quality_bad_response');
      const graded = await gradeWritten(
        grader,
        rubricSnapshot(rubricId, rubric.criteria),
        { id: item.itemVersionId, promptText: item.stem },
        answer?.final_text,
      );
      score = graded.score;
      const sessionItemId = servedItem.get(item.itemVersionId);
      if (graded.run !== null) {
        if (sessionItemId === undefined) return fail('quality_bad_response');
        runs.push({
          sessionItemId,
          modelId: graded.run.modelId,
          adapterVersion: graded.run.adapterVersion,
          rubricVersionId: rubricId,
          rawScore: (graded.run.totalPercent / 100).toFixed(4),
          // Ids and numbers only, never answer text.
          criteriaJson: JSON.stringify(
            graded.run.criteria.map((c) => ({ id: c.id, points: c.points, max: c.max })),
          ),
        });
      }
    } else {
      return fail('quality_bad_item');
    }
    itemScores.push({ id: entry.id, sectionId: entry.sectionId, score });
  }

  const result = computeAnswerQuality({
    sections: content.sections.map((s) => ({ id: s.id, weight: parseWeight(s.weight) })),
    items: itemScores,
  });
  const meets = meetsCutoff(result.score, content.cutoff);

  const models = new Set(runs.map((r) => r.modelId));
  const adapters = new Set(runs.map((r) => r.adapterVersion));
  if (models.size > 1 || adapters.size > 1) return fail('quality_grader_mixed');
  const graderModelId = runs[0]?.modelId ?? NO_GRADER;
  const graderAdapterVersion = runs[0]?.adapterVersion ?? NO_GRADER;

  const rubricIds = [...usedRubrics.keys()].sort();
  if (rubricIds.length > 20) return fail('quality_too_many_rubrics');
  const sectionScores = SectionScores.safeParse(result.sections);
  if (!sectionScores.success) return fail('quality_bad_section_scores');

  // One transaction (m-6): runs, score, card, pointer and key commit together.
  for (const run of runs) await insertGraderRun(tx, orgId, sessionId, run);
  const scoreId = await upsertScore(tx, orgId, sessionId, {
    testVersionId: session.test_version_id,
    score: result.score,
    sectionScoresJson: JSON.stringify(sectionScores.data),
    cutoff: content.cutoff,
    meetsCutoff: meets,
    scoringVersion: message.v === 2 ? SCORING_VERSION_V2 : SCORING_VERSION,
    rubricSetSha256: await rubricSetSha256([...usedRubrics.values()]),
    rubricVersionIdsJson: JSON.stringify(rubricIds),
    graderModelId,
    graderAdapterVersion,
  });
  const cardId = await upsertCard(tx, orgId, sessionId, scoreId);
  await attachCard(tx, orgId, sessionId, cardId);
  await insertKey(tx, orgId, key, cardId, message.submittedAt);
};

const FALLBACK = 'quality_failed';

const CONSTANT_CODE = /^[a-z][a-z0-9_]{2,63}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Every error leaves the stage as a constant code: our own codes pass through; anything else (a driver or database
 * error, whose fields may quote row values) becomes `FALLBACK`, keeping only a well-formed SQLSTATE in `code` so a
 * caller can still tell a serialization failure (40001) from other failures.
 */
const constantError = (err: unknown): Error => {
  if (err instanceof Error && CONSTANT_CODE.test(err.message)) return err;
  const out = new Error(FALLBACK);
  const code =
    typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && SQLSTATE.test(code)) Object.assign(out, { code });
  return out;
};

/** The stage entry point (the consumer injects `deps.tx`, one transaction as the stage's worker role). */
export const runQuality = async (
  message: SessionMirrorMessage,
  deps: QualityDeps,
): Promise<void> => {
  try {
    await runQualityUnsafe(message, deps);
  } catch (err) {
    throw constantError(err);
  }
};
