// Answer Quality arithmetic (spec d1 §5.4, D1-8). Pure: no I/O, no clock, integer arithmetic only.
// Rule 1: the input is the item scores and the section weights, nothing else. There is no integrity parameter, and
// an unknown key is refused rather than ignored, so no band, flag or coverage value can ever reach the score.

export const SCORING_VERSION = 'd1-scoring-v1';

export interface ScoreSection {
  id: string;
  /** Integer 1..100 (sections.weight, converted by parseWeight). */
  weight: number;
}

export interface ScoreItem {
  id: string;
  sectionId: string;
  /** Integer 0..100. Unanswered and never-served items are 0. */
  score: number;
}

export interface ScoreInput {
  sections: readonly ScoreSection[];
  items: readonly ScoreItem[];
}

/** One entry of quality.scores.section_scores (the QualityCardRow contract). */
export interface SectionScore {
  sectionId: string;
  weight: number;
  scoreHundredths: number;
}

export interface AnswerQuality {
  score: number;
  sections: SectionScore[];
}

const BAD_INPUT = 'quality_bad_input';

const fail = (code: string): never => {
  throw new Error(code);
};

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(value, k));
};

/** round-half-up of n / d for n >= 0 and d > 0, in integers. */
export const roundHalfUpDiv = (n: number, d: number): number => Math.floor((2 * n + d) / (2 * d));

/**
 * sections.weight is numeric(5,2); the postgres driver hands it over as a string. D1 weights are integers 1..100
 * (the authoring contract), so anything else (a fraction, 0, out of range, not a number) is refused.
 */
export const parseWeight = (text: string): number => {
  const m = /^([0-9]{1,3})(?:\.(0{1,2}))?$/.exec(text);
  if (m === null) return fail('quality_bad_weight');
  const n = Number(m[1]);
  if (!isInt(n, 1, 100)) return fail('quality_bad_weight');
  return n;
};

/** meets_cutoff = (score >= cutoff); the cutoff is mandatory (L-15), so a missing one is an error, never a pass. */
export const meetsCutoff = (score: number, cutoff: number): boolean => {
  if (!isInt(cutoff, 0, 100)) return fail('quality_bad_cutoff');
  if (!isInt(score, 0, 100)) return fail(BAD_INPUT);
  return score >= cutoff;
};

/**
 * Section score (hundredths) = round(10000 · Σ item scores / (100 · items in section)); Answer Quality =
 * roundHalfUp(Σ w_s · section_s / (100 · Σ w_s)), an integer 0..100. Sections are returned in input order.
 */
export function computeAnswerQuality(input: ScoreInput): AnswerQuality {
  if (!exactKeys(input, ['sections', 'items'])) return fail(BAD_INPUT);
  const { sections, items } = input;
  if (!Array.isArray(sections) || !Array.isArray(items) || sections.length === 0) {
    return fail(BAD_INPUT);
  }
  const sums = new Map<string, { sum: number; n: number }>();
  for (const s of sections as readonly unknown[]) {
    if (!exactKeys(s, ['id', 'weight'])) return fail(BAD_INPUT);
    if (typeof s['id'] !== 'string' || !isInt(s['weight'], 1, 100)) return fail(BAD_INPUT);
    if (sums.has(s['id'])) return fail(BAD_INPUT);
    sums.set(s['id'], { sum: 0, n: 0 });
  }
  const seen = new Set<string>();
  for (const it of items as readonly unknown[]) {
    if (!exactKeys(it, ['id', 'sectionId', 'score'])) return fail(BAD_INPUT);
    if (typeof it['id'] !== 'string' || typeof it['sectionId'] !== 'string') return fail(BAD_INPUT);
    if (!isInt(it['score'], 0, 100) || seen.has(it['id'])) return fail(BAD_INPUT);
    seen.add(it['id']);
    const acc = sums.get(it['sectionId']);
    if (acc === undefined) return fail(BAD_INPUT);
    acc.sum += it['score'];
    acc.n += 1;
  }

  let weighted = 0;
  let weights = 0;
  const out: SectionScore[] = [];
  for (const s of sections) {
    const acc = sums.get(s.id);
    if (acc === undefined || acc.n === 0) return fail(BAD_INPUT);
    // 10000 · sum / (100 · n) = 100 · sum / n
    const scoreHundredths = roundHalfUpDiv(100 * acc.sum, acc.n);
    out.push({ sectionId: s.id, weight: s.weight, scoreHundredths });
    weighted += s.weight * scoreHundredths;
    weights += s.weight;
  }
  return { score: roundHalfUpDiv(weighted, 100 * weights), sections: out };
}
