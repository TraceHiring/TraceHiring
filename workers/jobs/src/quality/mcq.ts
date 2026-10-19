// MCQ scoring (spec d1 §5.4): 100 for the exact key, otherwise 0. Unanswered is 0; no negative marking, no fuzzy
// match (option ids compare as exact strings).

export const scoreMcq = (selected: string | null | undefined, correct: string): 0 | 100 =>
  typeof selected === 'string' && selected === correct ? 100 : 0;
