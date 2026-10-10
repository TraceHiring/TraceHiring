// Answer Quality: the mock grader (plan §7.1). It is deterministic and transparent:
// MCQ is scored on the exact key; a written answer is scored on a keyword + length rubric.
// It stands in for the LLM rubric grader. It never reads integrity data (rule 1):
// its only inputs are the test items and the final answers.
export const GRADER_VERSION = 'mock-grader v1';

/** Share of a written item's points that come from rubric keywords; the rest is length. */
export const CONTENT_SHARE = 0.7;

function normalise(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ');
}

/** A keyword matches when any word in the answer starts with it ("apolog" matches "apologise"). */
export function matchKeywords(answer, keywords) {
  const words = normalise(answer).split(/\s+/).filter(Boolean);
  const matched = [];
  const missing = [];
  for (const raw of keywords) {
    const stem = normalise(raw).trim();
    if (!stem) continue;
    if (words.some((w) => w.startsWith(stem))) matched.push(raw);
    else missing.push(raw);
  }
  return { matched, missing };
}

function countWords(text) {
  return String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * @param {{items: Array}} test
 * @param {Record<string, unknown>} answers final answers keyed by item id
 */
export function grade(test, answers) {
  const items = test.items.map((item) => {
    const answer = answers?.[item.id];
    if (item.type === 'mcq') {
      const answered = answer !== undefined && answer !== null && answer !== '';
      const correct = answered && Number(answer) === Number(item.correct);
      return {
        itemId: item.id,
        type: 'mcq',
        points: item.points,
        earned: correct ? item.points : 0,
        answered,
        correct,
        detail: !answered ? 'Not answered' : correct ? 'Correct' : 'Incorrect',
      };
    }
    const keywords = item.rubric.keywords ?? [];
    const { matched, missing } = matchKeywords(answer, keywords);
    const words = countWords(answer);
    const contentPts = item.points * CONTENT_SHARE;
    const lengthPts = item.points - contentPts;
    const content = keywords.length ? (contentPts * matched.length) / keywords.length : contentPts;
    const length = lengthPts * Math.min(1, words / Math.max(1, item.rubric.minWords));
    return {
      itemId: item.id,
      type: 'written',
      points: item.points,
      earned: words === 0 ? 0 : round1(content + length),
      answered: words > 0,
      matched,
      missing,
      words,
      minWords: item.rubric.minWords,
      criteria: [
        { name: 'Rubric points covered', earned: round1(content), max: round1(contentPts) },
        { name: 'Length and completeness', earned: round1(length), max: round1(lengthPts) },
      ],
      detail:
        words === 0
          ? 'Not answered'
          : `Covered ${matched.length} of ${keywords.length} rubric points · ${words} words (aim ${item.rubric.minWords}+)`,
    };
  });
  const max = items.reduce((s, i) => s + i.points, 0);
  const earned = items.reduce((s, i) => s + i.earned, 0);
  const sections = {
    mcq: sum(items.filter((i) => i.type === 'mcq')),
    written: sum(items.filter((i) => i.type === 'written')),
  };
  return {
    graderVersion: GRADER_VERSION,
    score: max ? Math.round((100 * earned) / max) : 0,
    earned: round1(earned),
    max,
    sections,
    items,
  };
}

function sum(list) {
  return {
    earned: round1(list.reduce((s, i) => s + i.earned, 0)),
    max: list.reduce((s, i) => s + i.points, 0),
  };
}
