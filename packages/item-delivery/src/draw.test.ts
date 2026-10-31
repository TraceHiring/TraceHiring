// drawSection examples and refusals (specs/m1-test-authoring.md §6.5, M1-10, R2-13, R3-2, R5-52 b and c).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DrawError, drawSection, drawSeed, drawWeight } from './draw.js';
import { SECTION_ID, item, section, seedOf, uuidOf } from './test-fixtures.js';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DrawError);
    return (error as DrawError).code;
  }
  return 'accepted';
};

describe('drawWeight (R2-13, the one place Q-M1-4 changes)', () => {
  it('is 1 / (1 + exposureAtPublish)', () => {
    expect(drawWeight(0)).toBe(1);
    expect(drawWeight(1)).toBe(0.5);
    expect(drawWeight(3)).toBe(0.25);
    expect(drawWeight(9)).toBe(0.1);
  });

  it('refuses a count that is not a non-negative integer', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codeOf(() => drawWeight(bad))).toBe('bad_exposure');
    }
  });
});

describe('drawSection', () => {
  const pool = Array.from({ length: 12 }, (_, i) => item(i + 1, { exposureAtPublish: i }));

  it('a section without a draw serves all its items in package order when not shuffled', () => {
    const out = drawSection(section(), pool, seedOf(1));
    expect(out.sectionId).toBe(SECTION_ID);
    expect(out.items.map((d) => d.itemVersionId)).toEqual(pool.map((i) => i.itemVersionId));
    for (const d of out.items) {
      expect(d.variantIndex).toBeNull();
      expect(d.variantId).toBeNull();
      expect(d.optionOrder).toEqual(['o0', 'o1', 'o2', 'o3']);
    }
  });

  it('ignores items of other sections', () => {
    const other = item(99, { sectionId: uuidOf('5ec7', 2) });
    const out = drawSection(section(), [...pool, other], seedOf(1));
    expect(out.items.map((d) => d.itemVersionId)).not.toContain(other.itemVersionId);
    expect(out.items).toHaveLength(pool.length);
  });

  it('draws the count without replacement when there are no strata', () => {
    const out = drawSection(section({ draw: { count: 5, strata: [] } }), pool, seedOf(2));
    const ids = out.items.map((d) => d.itemVersionId);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it('meets each stratum quota, strata in order when items are not shuffled', () => {
    const mixed = [
      ...Array.from({ length: 6 }, (_, i) => item(i + 1, { skillKey: 'quant', difficultyBand: 1 })),
      ...Array.from({ length: 6 }, (_, i) =>
        item(i + 11, { skillKey: 'verbal', difficultyBand: 3 }),
      ),
      item(30, { skillKey: 'logic', difficultyBand: 0 }),
    ];
    const s = section({
      draw: {
        count: 5,
        strata: [
          { skillKey: 'verbal', difficultyBand: 3, count: 2 },
          { skillKey: 'quant', difficultyBand: 1, count: 3 },
        ],
      },
    });
    const out = drawSection(s, mixed, seedOf(3));
    const skills = out.items.map(
      (d) => mixed.find((i) => i.itemVersionId === d.itemVersionId)!.skillKey,
    );
    expect(skills).toEqual(['verbal', 'verbal', 'quant', 'quant', 'quant']);
  });

  it('is identical for the same seed and differs across seeds', () => {
    const s = section({ draw: { count: 6, strata: [] }, shuffleItems: true, shuffleOptions: true });
    const a = drawSection(s, pool, seedOf(4));
    expect(drawSection(structuredClone(s), structuredClone(pool), seedOf(4))).toEqual(a);
    const others = [5, 6, 7, 8].map((n) => drawSection(s, pool, seedOf(n)));
    expect(others.some((o) => JSON.stringify(o) !== JSON.stringify(a))).toBe(true);
  });

  it('uses only the first 128 bits of the seed', () => {
    const s = section({ draw: { count: 6, strata: [] }, shuffleItems: true });
    const long = seedOf(9, 32);
    const short = long.slice(0, 16);
    expect(drawSection(s, pool, short)).toEqual(drawSection(s, pool, long));
  });

  it('picks a variant for a parameterised item and shuffles its options when asked', () => {
    const items = [item(1, { variants: 7, options: 5 }), item(2, { options: 3 })];
    const out = drawSection(section({ shuffleOptions: true }), items, seedOf(10));
    const [first, second] = out.items;
    expect(first!.variantIndex).not.toBeNull();
    expect(first!.variantIndex! >= 0 && first!.variantIndex! < 7).toBe(true);
    expect(first!.variantId).toBe(items[0]!.variants![first!.variantIndex!]!.variantId);
    expect([...first!.optionOrder!].sort()).toEqual(['o0', 'o1', 'o2', 'o3', 'o4']);
    expect(second!.variantIndex).toBeNull();
    expect([...second!.optionOrder!].sort()).toEqual(['o0', 'o1', 'o2']);
  });

  it('gives written items no option order', () => {
    const items = [item(1, { kind: 'written' }), item(2, { kind: 'written' })];
    const out = drawSection(
      section({
        format: 'written',
        navigation: 'forward_only',
        pasteRule: 'blocked',
        shuffleOptions: true,
      }),
      items,
      seedOf(11),
    );
    for (const d of out.items) expect(d.optionOrder).toBeNull();
  });

  it('returns plain serialisable data', () => {
    const s = section({ draw: { count: 4, strata: [] }, shuffleItems: true, shuffleOptions: true });
    const out = drawSection(s, pool, seedOf(12));
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });
});

describe('drawSection refusals (typed DrawError)', () => {
  const pool = Array.from({ length: 4 }, (_, i) => item(i + 1, { difficultyBand: i < 2 ? 1 : 2 }));

  it('a seed shorter than 128 bits', () => {
    expect(codeOf(() => drawSection(section(), pool, new Uint8Array(15)))).toBe('bad_seed');
  });

  it('a stratum with fewer matching items than its quota (the package refine and publish refuse it upstream)', () => {
    const s = section({
      draw: {
        count: 3,
        strata: [{ skillKey: 'quant', difficultyBand: 1, count: 3 }],
      },
    });
    expect(codeOf(() => drawSection(s, pool, seedOf(1)))).toBe('stratum_too_small');
  });

  it('a draw larger than the section', () => {
    const s = section({ draw: { count: 5, strata: [] } });
    expect(codeOf(() => drawSection(s, pool, seedOf(1)))).toBe('draw_too_large');
  });

  it('strata that do not add up to the count', () => {
    const s = section({
      draw: { count: 3, strata: [{ skillKey: 'quant', difficultyBand: 1, count: 2 }] },
    });
    expect(codeOf(() => drawSection(s, pool, seedOf(1)))).toBe('strata_mismatch');
  });

  it('the same stratum twice', () => {
    const s = section({
      draw: {
        count: 2,
        strata: [
          { skillKey: 'quant', difficultyBand: 1, count: 1 },
          { skillKey: 'quant', difficultyBand: 1, count: 1 },
        ],
      },
    });
    expect(codeOf(() => drawSection(s, pool, seedOf(1)))).toBe('duplicate_stratum');
  });

  it('an item version listed twice', () => {
    expect(codeOf(() => drawSection(section(), [...pool, pool[0]!], seedOf(1)))).toBe(
      'duplicate_item',
    );
  });

  it('a section with no items', () => {
    expect(codeOf(() => drawSection(section(), [], seedOf(1)))).toBe('no_items');
  });

  it('a bad exposure count', () => {
    const bad = [{ ...pool[0]!, exposureAtPublish: -1 }, ...pool.slice(1)];
    expect(
      codeOf(() => drawSection(section({ draw: { count: 2, strata: [] } }), bad, seedOf(1))),
    ).toBe('bad_exposure');
  });
});

describe('drawSeed (M1-10, R5-52 b)', () => {
  const session = '0a1b2c3d-0000-4000-8000-00000000abcd';

  it('is SHA-256(utf8(session_id) || utf8(section_id))', async () => {
    const seed = await drawSeed(session, SECTION_ID);
    const expected = createHash('sha256').update(`${session}${SECTION_ID}`, 'utf8').digest();
    expect(Buffer.from(seed).equals(expected)).toBe(true);
  });

  it('refuses ids that are not lower-case uuids', async () => {
    await expect(drawSeed(session.toUpperCase(), SECTION_ID)).rejects.toThrow(RangeError);
    await expect(drawSeed(session, 'section-1')).rejects.toThrow(RangeError);
  });
});
