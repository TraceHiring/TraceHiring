// A variant's difficulty (specs/m1-test-authoring.md §6.3, ABH-7, I-M1-4, AT-M1-05): the parent's unless the author
// sets one, and an author value more than 0.10 from the parent's is refused here, before insert (the item_variants
// trigger refuses it again). Difficulties are numeric(3,2) in 0..1, so the comparison runs in whole hundredths and
// 0.4 vs 0.3 is exactly 10 hundredths, not 0.10000000000000003.

export type VariantDifficultyErrorCode = 'bad_difficulty' | 'difficulty_too_far';

export class VariantDifficultyError extends Error {
  readonly code: VariantDifficultyErrorCode;
  constructor(code: VariantDifficultyErrorCode) {
    super(`variant difficulty: ${code}`);
    this.name = 'VariantDifficultyError';
    this.code = code;
  }
}

/** At most this many hundredths between a variant's difficulty and its parent's. */
const MAX_DELTA_HUNDREDTHS = 10;

function hundredths(x: unknown): number {
  if (typeof x !== 'number' || !Number.isFinite(x))
    throw new VariantDifficultyError('bad_difficulty');
  const h = Math.round(x * 100);
  if (h < 0 || h > 100 || Math.abs(h - x * 100) > 1e-6) {
    throw new VariantDifficultyError('bad_difficulty');
  }
  return h;
}

/**
 * The difficulty to store for a variant: `author` when given and within 0.10 of `parent`, else `parent`.
 * Throws VariantDifficultyError for a value that is not a 0.00-1.00 two-decimal difficulty or is too far.
 */
export function variantDifficulty(parent: number, author?: number): number {
  const p = hundredths(parent);
  if (author === undefined) return p / 100;
  const a = hundredths(author);
  if (Math.abs(a - p) > MAX_DELTA_HUNDREDTHS)
    throw new VariantDifficultyError('difficulty_too_far');
  return a / 100;
}
