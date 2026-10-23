// Variant generation (specs/m1-test-authoring.md §6.3, E14, E15, AT-M1-04; seeds R5-52 b). Synthetic content only.
import { createHash } from 'node:crypto';
import type { ParamSpec } from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import {
  MAX_ATTEMPTS_PER_VARIANT,
  generateVariants,
  generateVariantsFor,
  validateParamSpec,
  variantSeed,
  type GeneratedVariant,
} from './generate.js';

const ITEM = '0b7c2f6e-1d3a-4c5b-8e9f-112233445566';

const SUM_SPEC: ParamSpec = {
  params: {
    a: { kind: 'int', min: 2, max: 20, step: 1 },
    b: { kind: 'int', min: 2, max: 20, step: 2 },
  },
  derived: { s: 'a + b', sp: 's + 1', sm: 's - 1', p: 'a * b' },
  constraints: ['a != b'],
  stem: '[synthetic] What is {{a}} + {{b}}?',
  options: [
    { id: 'a', text: '{{s}}' },
    { id: 'b', text: '{{sp}}' },
    { id: 'c', text: '{{sm}}' },
    { id: 'd', text: '{{p}}' },
  ],
  correctOptionId: 'a',
  count: 10,
};

/** Deterministic synthetic seeds: byte i of seed k is (k * 31 + i * 7) mod 256. */
const seedsFor = (count: number, salt = 0): Uint8Array[] =>
  Array.from({ length: count }, (_, k) =>
    Uint8Array.from({ length: 32 }, (_, i) => (salt + k * 31 + i * 7) % 256),
  );

const variantsOf = (spec: ParamSpec, seeds = seedsFor(spec.count)): readonly GeneratedVariant[] => {
  const result = generateVariants(spec, seeds);
  if (!result.ok) throw new Error(`generation failed: ${result.code}`);
  return result.variants;
};

describe('generateVariants', () => {
  it('is deterministic: the same seeds give the same variants', () => {
    const first = variantsOf(SUM_SPEC);
    const again = variantsOf(structuredClone(SUM_SPEC), seedsFor(SUM_SPEC.count));
    expect(again).toEqual(first);
    expect(first).toHaveLength(10);
    expect(first.map((v) => v.variantNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('different seeds give different variants', () => {
    expect(variantsOf(SUM_SPEC, seedsFor(10, 1))).not.toEqual(variantsOf(SUM_SPEC));
  });

  it('does not depend on the key order of params or derived (jsonb reorders keys)', () => {
    const reordered: ParamSpec = {
      ...SUM_SPEC,
      params: { b: SUM_SPEC.params['b']!, a: SUM_SPEC.params['a']! },
      derived: { p: 'a * b', sm: 's - 1', sp: 's + 1', s: 'a + b' },
    };
    expect(variantsOf(reordered)).toEqual(variantsOf(SUM_SPEC));
  });

  it('renders stem and options from the drawn tuple and keeps the key on the parent option id', () => {
    for (const v of variantsOf(SUM_SPEC)) {
      const a = v.params['a'] as number;
      const b = v.params['b'] as number;
      expect(a).not.toBe(b);
      expect(b % 2).toBe(0);
      expect(v.stem).toBe(`[synthetic] What is ${a} + ${b}?`);
      expect(v.options).toEqual([
        { id: 'a', text: String(a + b) },
        { id: 'b', text: String(a + b + 1) },
        { id: 'c', text: String(a + b - 1) },
        { id: 'd', text: String(a * b) },
      ]);
      expect(v.correctOptionId).toBe('a');
      expect(v.options.map((o) => o.id)).toContain(v.correctOptionId);
    }
  });

  it('never repeats a variant', () => {
    const keys = variantsOf(SUM_SPEC).map((v) => JSON.stringify([v.stem, v.options]));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('rejects tuples that break a constraint and fails after 50 x count attempts (E14)', () => {
    // Four tuples: a = 3 breaks the constraint and (2, 2) renders 4 twice, so only (2, 4) is ever accepted.
    const narrow: ParamSpec = {
      ...SUM_SPEC,
      params: {
        a: { kind: 'int', min: 2, max: 3, step: 1 },
        b: { kind: 'int', min: 2, max: 4, step: 2 },
      },
      constraints: ['a < 3'],
      count: 5,
    };
    const result = generateVariants(narrow, seedsFor(5));
    expect(MAX_ATTEMPTS_PER_VARIANT).toBe(50);
    expect(result).toEqual({
      ok: false,
      code: 'variant_generation_failed',
      accepted: 1,
      attempts: 250,
    });
  });

  it('rejects a tuple that renders two equal options (E15)', () => {
    const equal: ParamSpec = {
      ...SUM_SPEC,
      params: { a: { kind: 'int', min: 1, max: 12, step: 1 } },
      derived: { d: 'a * 2', q: 'a ^ 2' },
      constraints: [],
      stem: '[synthetic] Double {{a}}?',
      options: [
        { id: 'a', text: '{{d}}' },
        { id: 'b', text: '{{q}}' },
      ],
      count: 5,
    };
    // a = 2 renders "4" twice and must never be accepted.
    const variants = variantsOf(equal);
    expect(variants.map((v) => v.params['a'])).not.toContain(2);
    for (const v of variants) expect(new Set(v.options.map((o) => o.text)).size).toBe(2);
  });

  it('compares options after trimming and collapsing whitespace', () => {
    const spaced: ParamSpec = {
      ...SUM_SPEC,
      params: { a: { kind: 'int', min: 1, max: 1, step: 1 } },
      derived: {},
      constraints: [],
      stem: '[synthetic] {{a}}',
      options: [
        { id: 'a', text: '{{a}}  apples' },
        { id: 'b', text: ' {{a}} apples' },
      ],
      count: 5,
    };
    const result = generateVariants(spaced, seedsFor(5));
    expect(result.ok).toBe(false);
  });

  it('a division by zero rejects only that tuple', () => {
    const ratio: ParamSpec = {
      ...SUM_SPEC,
      params: {
        a: { kind: 'int', min: 1, max: 10, step: 1 },
        b: { kind: 'int', min: 1, max: 10, step: 1 },
      },
      derived: { q: '1 / (a - b)', s: 'a + b', p: 'a * b + 100' },
      constraints: [],
      stem: '[synthetic] {{a}} and {{b}} ({{q:2}})',
      options: [
        { id: 'a', text: '{{s}}' },
        { id: 'b', text: '{{p}}' },
      ],
      count: 8,
    };
    for (const v of variantsOf(ratio)) expect(v.params['a']).not.toBe(v.params['b']);
  });

  it('draws choice params, including text values used in templates only', () => {
    const choice: ParamSpec = {
      ...SUM_SPEC,
      params: {
        n: { kind: 'choice', values: [3, 5, 7, 11, 13] },
        unit: { kind: 'choice', values: ['kg', 'litres'] },
      },
      derived: { t: 'n * 2', u: 'n * 3' },
      constraints: [],
      stem: '[synthetic] {{n}} {{unit}} doubled?',
      options: [
        { id: 'a', text: '{{t}} {{unit}}' },
        { id: 'b', text: '{{u}} {{unit}}' },
      ],
      count: 6,
    };
    for (const v of variantsOf(choice)) {
      expect([3, 5, 7, 11, 13]).toContain(v.params['n']);
      expect(['kg', 'litres']).toContain(v.params['unit']);
      expect(v.stem).toBe(`[synthetic] ${v.params['n']} ${v.params['unit']} doubled?`);
    }
  });

  it('formats derived values', () => {
    const fmt: ParamSpec = {
      ...SUM_SPEC,
      params: { a: { kind: 'int', min: 1, max: 40, step: 1 } },
      derived: { third: 'a / 3', share: 'a / 40' },
      constraints: ['gcd(a, 3) == 1'],
      stem: '[synthetic] {{a}} split three ways is {{third:2}} ({{share:%}})',
      options: [
        { id: 'a', text: '{{third:2}}' },
        { id: 'b', text: '{{third:0}}.5' },
      ],
      count: 5,
    };
    for (const v of variantsOf(fmt)) {
      const a = v.params['a'] as number;
      expect(a % 3).not.toBe(0);
      expect(v.options[0]!.text).toBe((Math.round((a / 3) * 100) / 100).toFixed(2));
    }
  });

  it('refuses the wrong number of seeds or a seed shorter than 128 bits', () => {
    expect(() => generateVariants(SUM_SPEC, seedsFor(9))).toThrow(RangeError);
    expect(() =>
      generateVariants(SUM_SPEC, [...seedsFor(9), new Uint8Array(15)] as Uint8Array[]),
    ).toThrow(RangeError);
  });
});

describe('validateParamSpec (bad_param_spec)', () => {
  const reasonOf = (spec: unknown): string => {
    const result = validateParamSpec(spec);
    return result.ok ? 'ok' : result.reason;
  };

  it('accepts a good spec', () => {
    expect(reasonOf(SUM_SPEC)).toBe('ok');
  });

  it.each<[string, unknown, string]>([
    ['the contract shape (count below 5)', { ...SUM_SPEC, count: 4 }, 'invalid_shape'],
    ['not an object', 'a + b', 'invalid_shape'],
    [
      'a reserved param name',
      {
        ...SUM_SPEC,
        params: { ...SUM_SPEC.params, max: { kind: 'int', min: 1, max: 2, step: 1 } },
      },
      'reserved_name',
    ],
    [
      'a derived reserved name',
      { ...SUM_SPEC, derived: { ...SUM_SPEC.derived, not: 'a + 1' } },
      'reserved_name',
    ],
    ['an unknown name', { ...SUM_SPEC, derived: { s: 'a + q' } }, 'unknown_name'],
    ['a derived cycle', { ...SUM_SPEC, derived: { s: 't + 1', t: 's + 1' } }, 'cycle'],
    ['a self reference', { ...SUM_SPEC, derived: { s: 's + 1' } }, 'cycle'],
    ['a parse error in a derived value', { ...SUM_SPEC, derived: { s: 'a +' } }, 'unexpected_end'],
    ['a comparison as a derived value', { ...SUM_SPEC, derived: { s: 'a < b' } }, 'not_allowed'],
    ['a number as a constraint', { ...SUM_SPEC, constraints: ['a + b'] }, 'type_mismatch'],
    [
      'a text param in an expression',
      {
        ...SUM_SPEC,
        params: { ...SUM_SPEC.params, unit: { kind: 'choice', values: ['kg', 2] } },
        constraints: ['unit > 1'],
      },
      'non_numeric_param',
    ],
    [
      'a format on a text param',
      {
        ...SUM_SPEC,
        params: { ...SUM_SPEC.params, unit: { kind: 'choice', values: ['kg'] } },
        stem: '[synthetic] {{unit:2}}',
      },
      'format_on_text',
    ],
    ['an unknown template name', { ...SUM_SPEC, stem: '[synthetic] {{zz}}' }, 'unknown_name'],
    [
      'a bad option template',
      { ...SUM_SPEC, options: [...SUM_SPEC.options.slice(0, 3), { id: 'd', text: '{{p' }] },
      'bad_template',
    ],
  ])('refuses %s', (_label, spec, reason) => {
    expect(reasonOf(spec)).toBe(reason);
  });

  // Lead note (security review of the M1 contracts): never look a name up on a plain object. A spec that names a
  // param after an Object.prototype member works like any other, and one that only references it is refused.
  const PROTO_NAMES = [
    'constructor',
    'prototype',
    'hasownproperty',
    'isprototypeof',
    'valueof',
    'tostring',
  ];
  it.each(PROTO_NAMES)('the name %j is never resolved through a prototype', (name) => {
    expect(reasonOf({ ...SUM_SPEC, derived: { ...SUM_SPEC.derived, s: `a + ${name}` } })).toBe(
      'unknown_name',
    );
    expect(reasonOf({ ...SUM_SPEC, stem: `[synthetic] {{${name}}}` })).toBe('unknown_name');
    const named: ParamSpec = {
      ...SUM_SPEC,
      params: { a: SUM_SPEC.params['a']!, [name]: { kind: 'int', min: 2, max: 20, step: 2 } },
      derived: { s: `a + ${name}`, sp: 's + 1', sm: 's - 1', p: `a * ${name}` },
      constraints: [`a != ${name}`],
      stem: `[synthetic] What is {{a}} + {{${name}}}?`,
    };
    const plain: ParamSpec = { ...SUM_SPEC, stem: '[synthetic] What is {{a}} + {{b}}?' };
    const got = variantsOf(named);
    const want = variantsOf(plain);
    // Same draws whatever the second name is called: only the params key differs.
    expect(got.map((v) => [v.stem, v.options])).toEqual(want.map((v) => [v.stem, v.options]));
    for (const v of got) {
      expect(Object.keys(v.params).sort()).toEqual(['a', name].sort());
      expect(Object.hasOwn(v.params, name)).toBe(true);
      expect(typeof v.params[name]).toBe('number');
    }
  });

  it('generateVariants returns bad_param_spec for a refused spec', () => {
    const result = generateVariants({ ...SUM_SPEC, derived: { s: 'a +' } }, seedsFor(10));
    expect(result).toMatchObject({ ok: false, code: 'bad_param_spec', reason: 'unexpected_end' });
  });
});

describe('variantSeed (R5-52 b)', () => {
  it('is SHA-256(utf8(item_version_id) || utf8(decimal variant_no))', async () => {
    const seed = await variantSeed(ITEM, 7);
    const expected = createHash('sha256').update(`${ITEM}7`, 'utf8').digest();
    expect(Buffer.from(seed).equals(expected)).toBe(true);
    expect(seed).toHaveLength(32);
  });

  it('refuses an id that is not a lower-case uuid or a variant number below 1', async () => {
    await expect(variantSeed(ITEM.toUpperCase(), 1)).rejects.toThrow(RangeError);
    await expect(variantSeed('not-a-uuid', 1)).rejects.toThrow(RangeError);
    await expect(variantSeed(ITEM, 0)).rejects.toThrow(RangeError);
    await expect(variantSeed(ITEM, 1.5)).rejects.toThrow(RangeError);
  });

  it('generateVariantsFor seeds variant k with variantSeed(id, k)', async () => {
    const seeds = await Promise.all(
      Array.from({ length: SUM_SPEC.count }, (_, k) => variantSeed(ITEM, k + 1)),
    );
    const viaHelper = await generateVariantsFor(SUM_SPEC, ITEM);
    expect(viaHelper).toEqual(generateVariants(SUM_SPEC, seeds));
    expect(viaHelper.ok).toBe(true);
  });

  it('pins the tuples generated for a fixed item version id (regression pin)', async () => {
    const result = await generateVariantsFor(SUM_SPEC, ITEM);
    if (!result.ok) throw new Error(result.code);
    expect(result.variants.map((v) => v.params)).toEqual([
      { a: 7, b: 8 },
      { a: 5, b: 16 },
      { a: 2, b: 16 },
      { a: 16, b: 14 },
      { a: 15, b: 8 },
      { a: 11, b: 12 },
      { a: 14, b: 16 },
      { a: 11, b: 6 },
      { a: 4, b: 20 },
      { a: 12, b: 14 },
    ]);
  });

  it('generateVariantsFor reports a bad spec without hashing', async () => {
    const result = await generateVariantsFor({ ...SUM_SPEC, count: 0 }, ITEM);
    expect(result).toMatchObject({ ok: false, code: 'bad_param_spec', reason: 'invalid_shape' });
  });
});
