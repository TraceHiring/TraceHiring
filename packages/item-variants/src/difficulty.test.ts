// AT-M1-05 (package half, specs/m1-test-authoring.md §12, I-M1-4): a variant's difficulty is the parent's unless the
// author sets one, and an author value more than 0.10 away is refused before insert (the DB trigger refuses it too).
// Difficulties are numeric(3,2), so the check runs in whole hundredths: 0.4 - 0.3 is not 0.10000000000000003 here.
import { describe, expect, it } from 'vitest';
import { VariantDifficultyError, variantDifficulty } from './difficulty.js';

const codeOf = (parent: number, author?: number): string => {
  try {
    variantDifficulty(parent, author);
  } catch (error) {
    expect(error).toBeInstanceOf(VariantDifficultyError);
    return (error as VariantDifficultyError).code;
  }
  return 'accepted';
};

describe('variantDifficulty', () => {
  it("defaults to the parent's difficulty", () => {
    expect(variantDifficulty(0.55)).toBe(0.55);
    expect(variantDifficulty(0)).toBe(0);
  });

  it('accepts an author value exactly 0.10 away, in both directions and at the ends', () => {
    expect(variantDifficulty(0.5, 0.6)).toBe(0.6);
    expect(variantDifficulty(0.3, 0.4)).toBe(0.4);
    expect(variantDifficulty(0.3, 0.2)).toBe(0.2);
    expect(variantDifficulty(0.95, 1)).toBe(1);
    expect(variantDifficulty(0.05, 0)).toBe(0);
    expect(variantDifficulty(0.7, 0.7)).toBe(0.7);
  });

  it('refuses an author value 0.11 away', () => {
    expect(codeOf(0.5, 0.61)).toBe('difficulty_too_far');
    expect(codeOf(0.5, 0.39)).toBe('difficulty_too_far');
    expect(codeOf(0.3, 0.41)).toBe('difficulty_too_far');
    expect(codeOf(0, 1)).toBe('difficulty_too_far');
  });

  it('refuses a value that is not a numeric(3,2) difficulty in 0..1', () => {
    expect(codeOf(0.5, 0.405)).toBe('bad_difficulty');
    expect(codeOf(1.01)).toBe('bad_difficulty');
    expect(codeOf(-0.01)).toBe('bad_difficulty');
    expect(codeOf(Number.NaN)).toBe('bad_difficulty');
    expect(codeOf(0.5, Number.POSITIVE_INFINITY)).toBe('bad_difficulty');
    expect(codeOf('0.5' as unknown as number)).toBe('bad_difficulty');
  });
});
