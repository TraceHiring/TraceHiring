// Quality stage (spec d1 §5.1 row `quality`, §5.4; D1-8; L-5, L-6, m-6, n-4), as trace_quality_worker in the one
// transaction the consumer opens and commits. Reads the session's responses and the pinned test version's sections,
// items, keys, rubrics and cutoff; grades written answers through the injected LlmGrader; then writes grader runs,
// the score, the public quality card, reports.quality_card_id and the `quality_score` key, all in this transaction.
// Rule 1: nothing here reads or receives integrity data; the score function has no such parameter.
// Errors are constant codes; no answer text, score or id reaches a thrown message.
import type { SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import { canonicalJson } from '@trace/shared/canonical-json';
import { QualityCardRow } from '@trace/shared/contracts/d1';
import { jobKey, type SqlTx } from '@trace/shared/jobs';
import type { LlmGrader } from '@trace/vendors';
import { scoreMcq } from './mcq.js';
import { SCORING_VERSION, computeAnswerQuality, meetsCutoff, parseWeight } from './score.js';
import {
  attachCard,
  insertGraderRun,
  insertKey,
  keyExists,
  loadAnswers,
  loadContent,
  loadSession,
  upsertCard,
  upsertScore,
  type GraderRunInsert,
} from './store.js';
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

export const runQuality = async (
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

  const content = await loadContent(tx, orgId, session.test_version_id);
  const { servedItem, answers } = await loadAnswers(tx, orgId, sessionId);

  // Every item of the pinned version counts; an item never served or never answered scores 0.
  const itemScores: { id: string; sectionId: string; score: number }[] = [];
  const runs: GraderRunInsert[] = [];
  const usedRubrics = new Map<string, string>();
  for (const item of content.items) {
    const answer = answers.get(item.id);
    let score = 0;
    if (item.format === 'mcq') {
      const correct = content.answerKeys.get(item.id);
      if (correct === undefined) return fail('quality_bad_key');
      if (answer !== undefined && answer.answer_kind !== 'choice')
        return fail('quality_bad_response');
      score = scoreMcq(answer?.final_choice, correct);
    } else if (item.format === 'written') {
      const rubricId = item.rubric_version_id;
      const rubric = rubricId === null ? undefined : content.rubrics.get(rubricId);
      if (rubricId === null || rubric === undefined) return fail('quality_bad_rubric');
      usedRubrics.set(rubricId, rubric.content_sha256);
      if (answer !== undefined && answer.answer_kind !== 'text')
        return fail('quality_bad_response');
      const graded = await gradeWritten(
        grader,
        rubricSnapshot(rubricId, rubric.criteria),
        { id: item.id, promptText: item.stem },
        answer?.final_text,
      );
      score = graded.score;
      const sessionItemId = servedItem.get(item.id);
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
    itemScores.push({ id: item.id, sectionId: item.section_id, score });
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
    scoringVersion: SCORING_VERSION,
    rubricSetSha256: await rubricSetSha256([...usedRubrics.values()]),
    rubricVersionIdsJson: JSON.stringify(rubricIds),
    graderModelId,
    graderAdapterVersion,
  });
  const cardId = await upsertCard(tx, orgId, sessionId, scoreId);
  await attachCard(tx, orgId, sessionId, cardId);
  await insertKey(tx, orgId, key, cardId, message.submittedAt);
};
