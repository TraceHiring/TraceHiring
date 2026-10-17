// LlmGrader (specs/d1-demo-slice.md §5.3, D1-8): the interface the quality job grades written answers through, and
// the deterministic MockLlmGrader used in D1. The request carries no candidate, session, org or label field: the
// answer is data, graded against a versioned rubric snapshot. parseGradeRequest is strict (unknown keys fail at every
// level) and hand-written, because this package depends on @trace/shared only. Real adapters (M5) wrap `answer` in
// delimiters and escape the delimiter; the mock never interprets the answer, so instructions inside it change nothing.

export interface RubricCriterion {
  id: string;
  label: string;
  max: number;
  anchors: readonly string[];
  minHits: number;
}
export interface RubricSnapshot {
  rubricVersionId: string;
  criteria: readonly RubricCriterion[];
}
/** `answer` is DATA, never instructions. No identity field exists (a test pins the key set). */
export interface GradeRequest {
  rubric: RubricSnapshot;
  item: { id: string; promptText: string };
  answer: string;
}
export interface GradeResult {
  criteria: readonly { id: string; points: number; max: number }[];
  totalPercent: number;
  modelId: string;
  adapterVersion: string;
}
export interface LlmGrader {
  grade(req: GradeRequest, opts?: { signal?: AbortSignal }): Promise<GradeResult>;
}

export const MOCK_GRADER_MODEL_ID = 'mock-grader-v1';
export const MOCK_GRADER_ADAPTER_VERSION = 'mock-1';

/** Limits (the D1 draft contract: ≤ 8 criteria, ≤ 20 anchors of ≤ 100 chars, points 1..100). */
const LIMITS = {
  id: 64,
  label: 200,
  promptText: 4000,
  answer: 20_000,
  criteria: 8,
  anchors: 20,
  anchor: 100,
  max: 100,
} as const;

export type GradeRequestErrorCode = 'not_object' | 'unknown_key' | 'missing_key' | 'bad_value';

/** Names the failed check and a structural path; never the answer, prompt or rubric text. */
export class GradeRequestError extends Error {
  readonly code: GradeRequestErrorCode;
  constructor(code: GradeRequestErrorCode, path: string) {
    super(`grade request: ${code} at ${path}`);
    this.name = 'GradeRequestError';
    this.code = code;
  }
}

function plainObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GradeRequestError('not_object', path);
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new GradeRequestError('not_object', path);
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw new GradeRequestError('unknown_key', path);
  }
  for (const key of keys) {
    if (record[key] === undefined) throw new GradeRequestError('missing_key', `${path}.${key}`);
  }
}

function text(value: unknown, path: string, max: number, min = 1): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw new GradeRequestError('bad_value', path);
  }
  return value;
}

function int(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new GradeRequestError('bad_value', path);
  }
  return value;
}

function parseCriterion(raw: unknown, path: string): RubricCriterion {
  const c = plainObject(raw, path);
  exactKeys(c, ['id', 'label', 'max', 'anchors', 'minHits'], path);
  if (
    !Array.isArray(c['anchors']) ||
    c['anchors'].length < 1 ||
    c['anchors'].length > LIMITS.anchors
  ) {
    throw new GradeRequestError('bad_value', `${path}.anchors`);
  }
  const anchors = c['anchors'].map((a: unknown, i) =>
    text(a, `${path}.anchors[${i}]`, LIMITS.anchor),
  );
  return {
    id: text(c['id'], `${path}.id`, LIMITS.id),
    label: text(c['label'], `${path}.label`, LIMITS.label),
    max: int(c['max'], `${path}.max`, 1, LIMITS.max),
    anchors,
    minHits: int(c['minHits'], `${path}.minHits`, 1, anchors.length),
  };
}

/** Strict parse of a grade request; returns a fresh copy holding only the known keys. */
export function parseGradeRequest(raw: unknown): GradeRequest {
  const req = plainObject(raw, '$');
  exactKeys(req, ['rubric', 'item', 'answer'], '$');
  const rubric = plainObject(req['rubric'], '$.rubric');
  exactKeys(rubric, ['rubricVersionId', 'criteria'], '$.rubric');
  const rawCriteria = rubric['criteria'];
  if (
    !Array.isArray(rawCriteria) ||
    rawCriteria.length < 1 ||
    rawCriteria.length > LIMITS.criteria
  ) {
    throw new GradeRequestError('bad_value', '$.rubric.criteria');
  }
  const criteria = rawCriteria.map((c: unknown, i) => parseCriterion(c, `$.rubric.criteria[${i}]`));
  if (new Set(criteria.map((c) => c.id)).size !== criteria.length) {
    throw new GradeRequestError('bad_value', '$.rubric.criteria');
  }
  const item = plainObject(req['item'], '$.item');
  exactKeys(item, ['id', 'promptText'], '$.item');
  return {
    rubric: {
      rubricVersionId: text(rubric['rubricVersionId'], '$.rubric.rubricVersionId', LIMITS.id),
      criteria,
    },
    item: {
      id: text(item['id'], '$.item.id', LIMITS.id),
      promptText: text(item['promptText'], '$.item.promptText', LIMITS.promptText),
    },
    answer: text(req['answer'], '$.answer', LIMITS.answer, 0),
  };
}

const normalise = (value: string): string => value.normalize('NFKC').toLowerCase();
const TOKEN_RE = /[\p{L}\p{N}]+/gu;

/** round-half-up of 100·n/d for non-negative integers, d > 0. */
const roundHalfUpPercent = (n: number, d: number): number => Math.floor((200 * n + d) / (2 * d));

/**
 * Deterministic, rubric-anchored mock (§5.3). The answer is normalised (NFKC, lower case) and tokenised on
 * `[\p{L}\p{N}]+`; per criterion `hits` = distinct anchors (normalised the same way) that prefix-match a token;
 * `points = floor(max · min(hits, minHits) / minHits)`; `totalPercent = roundHalfUp(100 · Σpoints / Σmax)`.
 * An empty answer scores 0. The prompt text never affects the score.
 */
export class MockLlmGrader implements LlmGrader {
  grade(req: GradeRequest, opts?: { signal?: AbortSignal }): Promise<GradeResult> {
    try {
      opts?.signal?.throwIfAborted();
      const parsed = parseGradeRequest(req);
      const tokens = normalise(parsed.answer).match(TOKEN_RE) ?? [];
      const criteria = parsed.rubric.criteria.map((criterion) => {
        const anchors = new Set(criterion.anchors.map(normalise).filter((a) => a.length > 0));
        let hits = 0;
        for (const anchor of anchors) {
          if (tokens.some((token) => token.startsWith(anchor))) hits += 1;
        }
        const points = Math.floor(
          (criterion.max * Math.min(hits, criterion.minHits)) / criterion.minHits,
        );
        return { id: criterion.id, points, max: criterion.max };
      });
      const sumPoints = criteria.reduce((sum, c) => sum + c.points, 0);
      const sumMax = criteria.reduce((sum, c) => sum + c.max, 0);
      return Promise.resolve({
        criteria,
        totalPercent: roundHalfUpPercent(sumPoints, sumMax),
        modelId: MOCK_GRADER_MODEL_ID,
        adapterVersion: MOCK_GRADER_ADAPTER_VERSION,
      });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('grade failed'));
    }
  }
}
