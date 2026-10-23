// AT-M1-18 (specs/m1-test-authoring.md §12; §6.5, M1-10, R2-13, R3-2): same seed -> same draw, order, options and
// variant; strata quotas met; no item twice; the spread matches the WEIGHTED expectation from exposureAtPublish.
//
// The chi-squared checks are not flaky: the 10,000 seeds are fixed (drawSeed of synthetic session ids 0..9999) and
// the draw is deterministic, so the statistic is one fixed number on every run and every machine. The bound is the
// p = 0.001 critical value for the degrees of freedom used (24.32 for 7), i.e. a correct weighted draw would fail on
// only 0.1% of possible seed sets; a power check shows the same statistic against the UNIFORM expectation is far
// above the bound, so the test does tell the weighted draw from a uniform one.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  drawSection,
  drawSeed,
  drawWeight,
  type PackageItem,
  type PackageSection,
} from './draw.js';
import { SECTION_ID, item, section, uuidOf } from './test-fixtures.js';

const RUNS = { numRuns: 200 };
const SKILLS = ['quant', 'verbal', 'logic'] as const;

interface Case {
  section: PackageSection;
  items: PackageItem[];
}

const arbItems: fc.Arbitrary<PackageItem[]> = fc
  .array(
    fc.record({
      skill: fc.constantFrom(...SKILLS),
      band: fc.integer({ min: 0, max: 4 }),
      exposure: fc.integer({ min: 0, max: 60 }),
      options: fc.integer({ min: 2, max: 6 }),
      variants: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 9 })),
    }),
    { minLength: 1, maxLength: 40 },
  )
  .map((rows) =>
    rows.map((row, n) =>
      item(n + 1, {
        skillKey: row.skill,
        difficultyBand: row.band,
        exposureAtPublish: row.exposure,
        options: row.options,
        variants: row.variants,
      }),
    ),
  );

/** A valid section for the items: no draw, a plain draw, or strata picked from the groups the items form. */
const arbCase: fc.Arbitrary<Case> = arbItems.chain((items) => {
  const groups = new Map<string, { skillKey: string; difficultyBand: number; size: number }>();
  for (const i of items) {
    const key = `${i.skillKey}:${i.difficultyBand}`;
    const g = groups.get(key) ?? {
      skillKey: i.skillKey,
      difficultyBand: i.difficultyBand,
      size: 0,
    };
    g.size += 1;
    groups.set(key, g);
  }
  const groupList = [...groups.values()];
  const arbStrata = fc.subarray(groupList, { minLength: 1 }).chain((picked) =>
    fc.tuple(...picked.map((g) => fc.integer({ min: 1, max: g.size }))).map((counts) =>
      picked.map((g, k) => ({
        skillKey: g.skillKey,
        difficultyBand: g.difficultyBand,
        count: counts[k]!,
      })),
    ),
  );
  const arbDraw = fc.oneof(
    fc.constant(null),
    fc.integer({ min: 1, max: items.length }).map((count) => ({ count, strata: [] })),
    arbStrata.map((strata) => ({ count: strata.reduce((n, s) => n + s.count, 0), strata })),
  );
  return fc
    .record({ draw: arbDraw, shuffleItems: fc.boolean(), shuffleOptions: fc.boolean() })
    .map((s) => ({ section: section(s), items }));
});

const arbSeed = fc.uint8Array({ minLength: 16, maxLength: 32 });

describe('drawSection properties (AT-M1-18)', () => {
  it('the same seed gives the same draw, order, options and variants', () => {
    fc.assert(
      fc.property(arbCase, arbSeed, ({ section: s, items }, seed) => {
        const a = drawSection(s, items, seed);
        const b = drawSection(structuredClone(s), structuredClone(items), Uint8Array.from(seed));
        expect(b).toEqual(a);
      }),
      RUNS,
    );
  });

  it('meets every quota, never serves an item twice and serves only the section items', () => {
    fc.assert(
      fc.property(arbCase, arbSeed, ({ section: s, items }, seed) => {
        const out = drawSection(s, items, seed);
        const ids = out.items.map((d) => d.itemVersionId);
        expect(new Set(ids).size).toBe(ids.length);
        const byId = new Map(items.map((i) => [i.itemVersionId, i]));
        for (const id of ids) expect(byId.has(id)).toBe(true);
        if (s.draw === null) {
          expect([...ids].sort()).toEqual(items.map((i) => i.itemVersionId).sort());
          if (!s.shuffleItems) expect(ids).toEqual(items.map((i) => i.itemVersionId));
          return;
        }
        expect(ids).toHaveLength(s.draw.count);
        const served = ids.map((id) => byId.get(id)!);
        s.draw.strata.forEach((st, k) => {
          const inStratum = served.filter(
            (i) => i.skillKey === st.skillKey && i.difficultyBand === st.difficultyBand,
          );
          expect(inStratum).toHaveLength(st.count);
          if (!s.shuffleItems) {
            // Unshuffled, the strata are served in order.
            const before = s.draw!.strata.slice(0, k).reduce((n, x) => n + x.count, 0);
            expect(served.slice(before, before + st.count)).toEqual(inStratum);
          }
        });
      }),
      RUNS,
    );
  });

  it('variants and option orders are well formed', () => {
    fc.assert(
      fc.property(arbCase, arbSeed, ({ section: s, items }, seed) => {
        const byId = new Map(items.map((i) => [i.itemVersionId, i]));
        for (const d of drawSection(s, items, seed).items) {
          const src = byId.get(d.itemVersionId)!;
          if (src.variants === undefined) {
            expect(d.variantIndex).toBeNull();
            expect(d.variantId).toBeNull();
          } else {
            expect(Number.isInteger(d.variantIndex)).toBe(true);
            expect(d.variantIndex! >= 0 && d.variantIndex! < src.variants.length).toBe(true);
            expect(d.variantId).toBe(src.variants[d.variantIndex!]!.variantId);
          }
          const options = (src.variants?.[d.variantIndex ?? 0]?.options ?? src.options)!;
          const ids = options.map((o) => o.id);
          expect([...d.optionOrder!].sort()).toEqual([...ids].sort());
          if (!s.shuffleOptions) expect(d.optionOrder).toEqual(ids);
        }
      }),
      RUNS,
    );
  });
});

// ---- Spread: chi-squared against the weighted expectation ----------------------------------------------------------

const SEEDS = 10_000;
/** p = 0.001 critical value of chi-squared with 7 degrees of freedom. */
const CHI2_BOUND_DF7 = 24.32;
const EXPOSURES = [0, 0, 1, 2, 3, 5, 9, 19];

const chi2 = (observed: readonly number[], expected: readonly number[]): number =>
  observed.reduce((sum, o, i) => sum + (o - expected[i]!) ** 2 / expected[i]!, 0);

async function fixedSeeds(): Promise<Uint8Array[]> {
  return Promise.all(
    Array.from({ length: SEEDS }, (_, n) => drawSeed(uuidOf('5e55', n), SECTION_ID)),
  );
}

describe('drawSection spread (AT-M1-18, R3-2)', async () => {
  const seeds = await fixedSeeds();
  const pool = EXPOSURES.map((e, n) => item(n + 1, { exposureAtPublish: e }));
  const weights = EXPOSURES.map(drawWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  const weightedExpected = weights.map((w) => (SEEDS * w) / total);
  const uniformExpected = EXPOSURES.map(() => SEEDS / EXPOSURES.length);
  const indexOf = new Map(pool.map((i, k) => [i.itemVersionId, k]));

  const firstPicks = (count: number): number[] => {
    const observed = EXPOSURES.map(() => 0);
    const s = section({ draw: { count, strata: [] } });
    for (const seed of seeds) {
      // Unshuffled, the first served item is the first weighted pick, whose probability is exactly w_i / sum(w).
      const first = drawSection(s, pool, seed).items[0]!;
      observed[indexOf.get(first.itemVersionId)!]! += 1;
    }
    return observed;
  };

  it('every expected count is at least 5 (the chi-squared approximation holds)', () => {
    expect(Math.min(...weightedExpected)).toBeGreaterThan(5);
  });

  it('a one-item draw follows the weights 1 / (1 + exposure)', () => {
    const observed = firstPicks(1);
    expect(observed.reduce((a, b) => a + b, 0)).toBe(SEEDS);
    expect(chi2(observed, weightedExpected)).toBeLessThan(CHI2_BOUND_DF7);
    // Power: the same counts are nowhere near a uniform draw.
    expect(chi2(observed, uniformExpected)).toBeGreaterThan(100 * CHI2_BOUND_DF7);
  });

  it('the first pick of a three-item draw follows the same weights', () => {
    expect(chi2(firstPicks(3), weightedExpected)).toBeLessThan(CHI2_BOUND_DF7);
  });

  it('within a stratum the weights apply to that stratum only', () => {
    const mixed = [
      ...pool,
      ...Array.from({ length: 4 }, (_, n) =>
        item(100 + n, { skillKey: 'verbal', exposureAtPublish: 0 }),
      ),
    ];
    const s = section({
      draw: {
        count: 2,
        strata: [
          { skillKey: 'quant', difficultyBand: 2, count: 1 },
          { skillKey: 'verbal', difficultyBand: 2, count: 1 },
        ],
      },
    });
    const observed = EXPOSURES.map(() => 0);
    for (const seed of seeds) {
      const first = drawSection(s, mixed, seed).items[0]!;
      observed[indexOf.get(first.itemVersionId)!]! += 1;
    }
    expect(chi2(observed, weightedExpected)).toBeLessThan(CHI2_BOUND_DF7);
  });
});
