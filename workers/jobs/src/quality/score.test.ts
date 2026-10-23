// AT-D15 (spec d1 §5.4) and AT-D3's quality half: the Answer Quality arithmetic. Vectors first, then seeded
// property loops (fast-check is not a dependency of @trace/jobs, so the properties run over a small seeded PRNG).
import { describe, expect, it } from 'vitest';
import {
  SCORING_VERSION,
  computeAnswerQuality,
  meetsCutoff,
  parseWeight,
  roundHalfUpDiv,
  type ScoreInput,
  type ScoreItem,
  type ScoreSection,
} from './score.js';
import { scoreMcq } from './mcq.js';
import {
  mcqKeyOf,
  planScoredItems,
  type DrawnItem,
  type PlanEntry,
  type PlanItem,
  type PlanSection,
} from './v2.js';

const S1 = '6c1f0e2a-4b7d-4c3e-9a51-2f8d7b6e1a01';
const S2 = '6c1f0e2a-4b7d-4c3e-9a51-2f8d7b6e1a02';
const S3 = '6c1f0e2a-4b7d-4c3e-9a51-2f8d7b6e1a03';
const item = (n: number, sectionId: string, score: number): ScoreItem => ({
  id: `9d4b2c7e-1f3a-4e8b-b6d2-${n.toString(16).padStart(12, '0')}`,
  sectionId,
  score,
});

describe('quality score vectors (AT-D15)', () => {
  it('names its scoring version', () => {
    expect(SCORING_VERSION).toBe('d1-scoring-v1');
  });

  it('scores an MCQ by exact key only, with no negative marking', () => {
    expect(scoreMcq('b', 'b')).toBe(100);
    expect(scoreMcq('a', 'b')).toBe(0);
    expect(scoreMcq('B', 'b')).toBe(0);
    expect(scoreMcq(' b', 'b')).toBe(0);
    expect(scoreMcq(null, 'b')).toBe(0);
    expect(scoreMcq(undefined, 'b')).toBe(0);
  });

  it('section score is round(10000 * sum / (100 * n)) in hundredths', () => {
    const one = (scores: number[]) =>
      computeAnswerQuality({
        sections: [{ id: S1, weight: 1 }],
        items: scores.map((s, i) => item(i + 1, S1, s)),
      }).sections[0]?.scoreHundredths;
    expect(one([100, 0])).toBe(5000);
    expect(one([100, 0, 0])).toBe(3333);
    expect(one([100, 100, 0])).toBe(6667);
    expect(one([0, 0])).toBe(0);
    expect(one([100])).toBe(10000);
  });

  it('rounds the score half up at x.5', () => {
    // one section at 49.50 -> 49.5 -> 50
    expect(
      computeAnswerQuality({
        sections: [{ id: S1, weight: 1 }],
        items: [item(1, S1, 99), item(2, S1, 0)],
      }).score,
    ).toBe(50);
    // (51.00 + 0) / 2 = 25.5 -> 26
    const half = computeAnswerQuality({
      sections: [
        { id: S1, weight: 1 },
        { id: S2, weight: 1 },
      ],
      items: [item(1, S1, 51), item(2, S2, 0)],
    });
    expect(half.score).toBe(26);
    // (24.50 + 0) / 2 = 12.25 -> 12
    expect(
      computeAnswerQuality({
        sections: [
          { id: S1, weight: 1 },
          { id: S2, weight: 1 },
        ],
        items: [item(1, S1, 49), item(2, S1, 0), item(3, S2, 0)],
      }).score,
    ).toBe(12);
  });

  it('weights sections by their integer weights', () => {
    const r = computeAnswerQuality({
      sections: [
        { id: S1, weight: 3 },
        { id: S2, weight: 1 },
      ],
      items: [item(1, S1, 100), item(2, S2, 0)],
    });
    expect(r.score).toBe(75);
    expect(r.sections).toEqual([
      { sectionId: S1, weight: 3, scoreHundredths: 10000 },
      { sectionId: S2, weight: 1, scoreHundredths: 0 },
    ]);
  });

  it('parses numeric(5,2) weights given as strings into integers, refusing anything else', () => {
    expect(parseWeight('1')).toBe(1);
    expect(parseWeight('2.00')).toBe(2);
    expect(parseWeight('100.00')).toBe(100);
    expect(parseWeight('40.0')).toBe(40);
    for (const bad of ['1.50', '0.00', '0', '101.00', '-1.00', 'abc', '', ' 1', '1e2', '1.001']) {
      expect(() => parseWeight(bad)).toThrow('quality_bad_weight');
    }
  });

  it('treats an item with score 0 (unanswered or never served) as 0 in its section', () => {
    const r = computeAnswerQuality({
      sections: [{ id: S1, weight: 1 }],
      items: [item(1, S1, 100), item(2, S1, 0), item(3, S1, 0), item(4, S1, 0)],
    });
    expect(r.sections[0]?.scoreHundredths).toBe(2500);
    expect(r.score).toBe(25);
  });

  it('meets_cutoff is score >= cutoff, never null', () => {
    expect(meetsCutoff(40, 40)).toBe(true);
    expect(meetsCutoff(39, 40)).toBe(false);
    expect(meetsCutoff(0, 0)).toBe(true);
    expect(meetsCutoff(100, 100)).toBe(true);
    expect(meetsCutoff(99, 100)).toBe(false);
    expect(() => meetsCutoff(50, null as unknown as number)).toThrow('quality_bad_cutoff');
    expect(() => meetsCutoff(50, 101)).toThrow('quality_bad_cutoff');
  });

  it('refuses malformed input with a constant error', () => {
    const bad: unknown[] = [
      { sections: [], items: [] },
      { sections: [{ id: S1, weight: 1 }], items: [] }, // a section without items
      { sections: [{ id: S1, weight: 1 }], items: [item(1, S2, 0)] }, // unknown section
      { sections: [{ id: S1, weight: 0 }], items: [item(1, S1, 0)] },
      { sections: [{ id: S1, weight: 1.5 }], items: [item(1, S1, 0)] },
      { sections: [{ id: S1, weight: 1 }], items: [item(1, S1, 101)] },
      { sections: [{ id: S1, weight: 1 }], items: [item(1, S1, 50.5)] },
      {
        sections: [
          { id: S1, weight: 1 },
          { id: S1, weight: 1 },
        ],
        items: [item(1, S1, 0)],
      },
      { sections: [{ id: S1, weight: 1 }], items: [item(1, S1, 0), item(1, S1, 0)] },
    ];
    for (const input of bad) {
      expect(() => computeAnswerQuality(input as ScoreInput)).toThrow('quality_bad_input');
    }
  });

  it('rounding helper is exact integer half-up', () => {
    expect(roundHalfUpDiv(1, 2)).toBe(1);
    expect(roundHalfUpDiv(3, 2)).toBe(2);
    expect(roundHalfUpDiv(5, 4)).toBe(1);
    expect(roundHalfUpDiv(0, 7)).toBe(0);
    expect(roundHalfUpDiv(2, 3)).toBe(1);
  });
});

describe('AT-D3: the score takes no integrity input', () => {
  it('has exactly one parameter whose keys are sections and items', () => {
    expect(computeAnswerQuality.length).toBe(1);
    const base: ScoreInput = { sections: [{ id: S1, weight: 1 }], items: [item(1, S1, 100)] };
    const score = computeAnswerQuality(base).score;
    // Any extra key (an integrity band, a flag, a coverage value) is refused, never read.
    for (const key of ['band', 'integrity', 'flags', 'coverage', 'signals', 'reviewState']) {
      expect(() =>
        computeAnswerQuality({ ...base, [key]: 'strong_concern' } as ScoreInput),
      ).toThrow('quality_bad_input');
    }
    expect(computeAnswerQuality(structuredClone(base)).score).toBe(score);
  });
});

// ---- seeded properties ------------------------------------------------------------------------------------------

const prng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const generate = (rand: () => number): { sections: ScoreSection[]; items: ScoreItem[] } => {
  const ids = [S1, S2, S3];
  const n = 1 + Math.floor(rand() * 3);
  const sections = ids.slice(0, n).map((id) => ({ id, weight: 1 + Math.floor(rand() * 100) }));
  const items: ScoreItem[] = [];
  let k = 1;
  for (const s of sections) {
    const m = 1 + Math.floor(rand() * 8);
    for (let j = 0; j < m; j += 1) {
      const kind = rand();
      const score = kind < 0.4 ? 100 : kind < 0.7 ? 0 : Math.floor(rand() * 101);
      items.push(item(k++, s.id, score));
    }
  }
  return { sections, items };
};

const shuffle = <T>(rand: () => number, list: readonly T[]): T[] => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

describe('quality score properties (AT-D15, seeded)', () => {
  const RUNS = 500;

  it('is an integer in 0..100', () => {
    const rand = prng(1);
    for (let r = 0; r < RUNS; r += 1) {
      const { score } = computeAnswerQuality(generate(rand));
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('does not depend on item order', () => {
    const rand = prng(2);
    for (let r = 0; r < RUNS; r += 1) {
      const input = generate(rand);
      const a = computeAnswerQuality(input);
      const b = computeAnswerQuality({
        sections: input.sections,
        items: shuffle(rand, input.items),
      });
      expect(b).toEqual(a);
    }
  });

  it('is monotone in correct MCQ answers', () => {
    const rand = prng(3);
    for (let r = 0; r < RUNS; r += 1) {
      const input = generate(rand);
      const before = computeAnswerQuality(input).score;
      const zeros = input.items.map((it, i) => (it.score === 0 ? i : -1)).filter((i) => i >= 0);
      if (zeros.length === 0) continue;
      const flip = zeros[Math.floor(rand() * zeros.length)]!;
      const items = input.items.map((it, i) => (i === flip ? { ...it, score: 100 } : it));
      expect(
        computeAnswerQuality({ sections: input.sections, items }).score,
      ).toBeGreaterThanOrEqual(before);
    }
  });

  it('is deterministic for the same responses', () => {
    const rand = prng(4);
    for (let r = 0; r < 100; r += 1) {
      const input = generate(rand);
      expect(computeAnswerQuality(structuredClone(input))).toEqual(computeAnswerQuality(input));
    }
  });
});

// ---- Package v2 (spec m1 R5-19, R5-47; AT-M1-21): the scored item set is the candidate's own set ---------------
describe('package v2 scored item set (AT-M1-21)', () => {
  const INLINE = S1;
  const POOL = S2;
  const NEVER = S3;
  const iv = (n: number) => `4e7a1c9d-2b5f-4d8e-a3c6-${n.toString(16).padStart(12, '0')}`;
  const VARIANT = '4e7a1c9d-2b5f-4d8e-a3c6-0000000000f1';
  const mcq = (n: number, sectionId: string, variantId: string | null = null): PlanItem => ({
    itemVersionId: iv(n),
    sectionId,
    format: 'mcq',
    stem: '[synthetic] stem',
    rubricVersionId: null,
    variantId,
  });
  const drawn = (n: number, position: number, variantId: string | null = null): DrawnItem => ({
    ...mcq(n, POOL, variantId),
    position,
  });
  const sections: PlanSection[] = [
    { id: INLINE, drawCount: null },
    { id: POOL, drawCount: 3 },
    { id: NEVER, drawCount: 2 },
  ];

  it('inline items as D1, then the drawn items in draw order, then empty slots up to draw_count', () => {
    const plan = planScoredItems(
      sections,
      [mcq(1, INLINE), mcq(2, INLINE)],
      [drawn(12, 2), drawn(11, 1)],
    );
    expect(plan.map((e) => [e.sectionId, e.item?.itemVersionId ?? null])).toEqual([
      [INLINE, iv(1)],
      [INLINE, iv(2)],
      [POOL, iv(11)],
      [POOL, iv(12)],
      [POOL, null],
      [NEVER, null],
      [NEVER, null],
    ]);
    expect(new Set(plan.map((e) => e.id)).size).toBe(plan.length);
  });

  const scoreOf = (plan: PlanEntry[], scores: Record<string, number>) =>
    computeAnswerQuality({
      sections: sections.map((s) => ({ id: s.id, weight: 1 })),
      items: plan.map((e) => ({
        id: e.id,
        sectionId: e.sectionId,
        score: e.item === null ? 0 : (scores[e.item.itemVersionId] ?? 0),
      })),
    }).sections.map((s) => s.scoreHundredths);

  it('pool section fully answered, partly answered, never entered', () => {
    const plan = planScoredItems(
      sections,
      [mcq(1, INLINE)],
      [drawn(11, 1), drawn(12, 2), drawn(13, 3)],
    );
    expect(scoreOf(plan, { [iv(1)]: 100, [iv(11)]: 100, [iv(12)]: 100, [iv(13)]: 100 })).toEqual([
      10000, 10000, 0,
    ]);
    expect(scoreOf(plan, { [iv(1)]: 100, [iv(11)]: 100 })).toEqual([10000, 3333, 0]);
  });

  it('a section entered but drawn short still counts draw_count slots (the denominator never shrinks)', () => {
    const plan = planScoredItems(sections, [mcq(1, INLINE)], [drawn(11, 1)]);
    expect(scoreOf(plan, { [iv(1)]: 100, [iv(11)]: 100 })).toEqual([10000, 3333, 0]);
  });

  it('refuses more drawn rows than draw_count, a repeated or out-of-range position, and an unknown section', () => {
    expect(() =>
      planScoredItems(sections, [], [drawn(11, 1), drawn(12, 2), drawn(13, 3), drawn(14, 4)]),
    ).toThrow(/^quality_bad_draw$/);
    expect(() => planScoredItems(sections, [], [drawn(11, 1), drawn(12, 1)])).toThrow(
      /^quality_bad_draw$/,
    );
    expect(() => planScoredItems(sections, [], [drawn(11, 0)])).toThrow(/^quality_bad_draw$/);
    expect(() => planScoredItems(sections, [], [{ ...drawn(11, 1), sectionId: iv(99) }])).toThrow(
      /^quality_bad_draw$/,
    );
    expect(() => planScoredItems(sections, [], [{ ...drawn(11, 1), sectionId: INLINE }])).toThrow(
      /^quality_bad_draw$/,
    );
    expect(() => planScoredItems(sections, [mcq(1, POOL)], [])).toThrow(/^quality_bad_item$/);
  });

  it('the variant key is used for a parameterised item; the item key for the others; none is an error', () => {
    const keys = new Map([[iv(11), 'a']]);
    const variantKeys = new Map([[VARIANT, 'c']]);
    expect(mcqKeyOf(mcq(11, POOL, VARIANT), keys, variantKeys)).toBe('c');
    expect(mcqKeyOf(mcq(11, POOL), keys, variantKeys)).toBe('a');
    expect(() => mcqKeyOf(mcq(12, POOL), keys, variantKeys)).toThrow(/^quality_bad_key$/);
    expect(() => mcqKeyOf(mcq(11, POOL, iv(77)), keys, variantKeys)).toThrow(/^quality_bad_key$/);
  });

  it('options are scored by id: the served order never changes the score', () => {
    const key = mcqKeyOf(mcq(11, POOL, VARIANT), new Map(), new Map([[VARIANT, 'c']]));
    expect(scoreMcq('c', key)).toBe(100);
    expect(scoreMcq('a', key)).toBe(0);
  });

  it('a v1 version (no pool section) gives the D1 item list unchanged', () => {
    const v1Sections: PlanSection[] = [{ id: INLINE, drawCount: null }];
    const plan = planScoredItems(v1Sections, [mcq(1, INLINE), mcq(2, INLINE)], []);
    expect(plan.map((e) => [e.id, e.item?.itemVersionId])).toEqual([
      [iv(1), iv(1)],
      [iv(2), iv(2)],
    ]);
  });
});
