// Written items (spec d1 §5.3, §5.4): an empty answer scores 0 and the grader is not called; otherwise the answer
// goes to the LlmGrader as DATA with the item's rubric version and its prompt, never with a candidate, session or
// org field. The stored rubric criteria are the api's shape `{id, label, max_points, anchors[], min_hits}`
// (services/api tests/authoring.ts); anything else fails closed with a constant code.
import type { GradeResult, LlmGrader, RubricSnapshot } from '@trace/vendors';

export interface WrittenGrade {
  /** Integer 0..100. */
  score: number;
  /** The grader's result; null when the grader was not called (empty answer). */
  run: GradeResult | null;
}

const fail = (code: string): never => {
  throw new Error(code);
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Builds the grader's rubric snapshot from rubric_versions.criteria (jsonb text). */
export const rubricSnapshot = (rubricVersionId: string, criteriaText: string): RubricSnapshot => {
  let raw: unknown;
  try {
    raw = JSON.parse(criteriaText);
  } catch {
    return fail('quality_bad_rubric');
  }
  if (!Array.isArray(raw) || raw.length === 0) return fail('quality_bad_rubric');
  const criteria = raw.map((c: unknown) => {
    if (!isRecord(c)) return fail('quality_bad_rubric');
    const { id, label, max_points: max, anchors, min_hits: minHits } = c;
    if (
      typeof id !== 'string' ||
      typeof label !== 'string' ||
      typeof max !== 'number' ||
      !Number.isInteger(max) ||
      typeof minHits !== 'number' ||
      !Array.isArray(anchors) ||
      !anchors.every((a: unknown) => typeof a === 'string')
    ) {
      return fail('quality_bad_rubric');
    }
    return { id, label, max, anchors: anchors as string[], minHits };
  });
  return { rubricVersionId, criteria };
};

/** True when the answer has no content to grade. */
export const isEmptyAnswer = (text: string | null | undefined): boolean =>
  text === null || text === undefined || text.trim() === '';

/** Grades one written answer. Every grader failure becomes the constant `quality_grade_failed`. */
export const gradeWritten = async (
  grader: LlmGrader,
  rubric: RubricSnapshot,
  item: { id: string; promptText: string },
  answer: string | null | undefined,
): Promise<WrittenGrade> => {
  if (isEmptyAnswer(answer)) return { score: 0, run: null };
  let result: GradeResult;
  try {
    result = await grader.grade({ rubric, item, answer: answer as string });
  } catch {
    return fail('quality_grade_failed');
  }
  const { totalPercent, criteria, modelId, adapterVersion } = result;
  if (
    !Number.isInteger(totalPercent) ||
    totalPercent < 0 ||
    totalPercent > 100 ||
    typeof modelId !== 'string' ||
    modelId.length < 1 ||
    modelId.length > 64 ||
    typeof adapterVersion !== 'string' ||
    adapterVersion.length < 1 ||
    adapterVersion.length > 64 ||
    !validCriteria(rubric, criteria)
  ) {
    return fail('quality_grade_failed');
  }
  return { score: totalPercent, run: result };
};

/**
 * Security review #4: the grader's per-criterion output must fit the rubric it was given: every id one of the
 * rubric's (no duplicates, so never more criteria than the rubric), `max` the rubric's max for that id and `points` an
 * integer in 0..max. Anything else fails the stage before a row is written.
 */
const validCriteria = (rubric: RubricSnapshot, criteria: unknown): boolean => {
  if (!Array.isArray(criteria) || criteria.length > rubric.criteria.length) return false;
  const maxById = new Map(rubric.criteria.map((c) => [c.id, c.max]));
  const seen = new Set<string>();
  for (const c of criteria as unknown[]) {
    if (!isRecord(c)) return false;
    const { id, points, max } = c;
    if (typeof id !== 'string' || seen.has(id) || !maxById.has(id)) return false;
    seen.add(id);
    if (typeof max !== 'number' || max !== maxById.get(id)) return false;
    if (typeof points !== 'number' || !Number.isInteger(points) || points < 0 || points > max) {
      return false;
    }
  }
  return true;
};
