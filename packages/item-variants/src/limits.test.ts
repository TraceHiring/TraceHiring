// Generation limits (A1 review round 1): a deterministic work meter bounds the CPU a valid spec can cost (security
// High), rendering never throws for a spec validateParamSpec accepts (security Medium), and a tuple whose stored
// JSON exceeds the database byte limits is rejected (database Low: octet_length(options::text) <= 8192 in
// mcq_options_valid, d1_authoring.sql; octet_length(params::text) <= 2048 on item_variants, m1_bank.sql).
// Synthetic content only.
import type { ParamSpec } from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import {
  GENERATION_WORK_BUDGET,
  TUPLE_WORK_BUDGET,
  generateVariants,
  validateParamSpec,
} from './generate.js';

const seedsFor = (count: number): Uint8Array[] =>
  Array.from({ length: count }, (_, k) =>
    Uint8Array.from({ length: 32 }, (_, i) => (k * 31 + i * 7 + 3) % 256),
  );

/** A balanced sum of `n` copies of `name`, without the outer parentheses (height about log2 n, under 16). */
function balanced(name: string, n: number): string {
  const go = (k: number): string =>
    k === 1 ? name : `(${go(Math.floor(k / 2))}+${go(Math.ceil(k / 2))})`;
  return go(n).slice(1, -1);
}

/** The reviewer's adversarial spec: every tuple costs a lot and is then rejected (all options render equal). */
function adversarial(pMin: number, pMax: number, count: number): ParamSpec {
  const sum = balanced('a', 50);
  const derived: Record<string, string> = { a: '((p/(p+1))^6)^6' };
  for (let i = 1; i <= 7; i += 1) derived[`d${i}`] = sum;
  return {
    params: { p: { kind: 'int', min: pMin, max: pMax, step: 1 } },
    derived,
    constraints: Array.from({ length: 8 }, () => `${sum}>=0`),
    stem: '{{a:4}}'.repeat(571),
    options: Array.from({ length: 6 }, (_, i) => ({ id: `o${i}`, text: '{{a:4}}'.repeat(71) })),
    correctOptionId: 'o0',
    count,
  };
}

/** A realistic maximal legitimate spec: 8 params, 8 derived values, 8 constraints, a long stem, count 200. */
const MAXIMAL: ParamSpec = {
  params: {
    p: { kind: 'int', min: 1000, max: 99000, step: 500 },
    r: { kind: 'int', min: 2, max: 18, step: 1 },
    t: { kind: 'int', min: 1, max: 6, step: 1 },
    n: { kind: 'int', min: 2, max: 40, step: 1 },
    m: { kind: 'int', min: 2, max: 40, step: 1 },
    k: { kind: 'choice', values: [2, 3, 4, 5, 6, 8, 10, 12] },
    q: { kind: 'int', min: 1, max: 9, step: 1 },
    unit: { kind: 'choice', values: ['[synthetic] units', '[synthetic] items'] },
  },
  derived: {
    ci: 'round(p * (1 + r / 100) ^ 3, 2)',
    si: 'p * r * 3 / 100',
    diff: 'ci - p - si',
    g: 'gcd(n, m)',
    l: 'lcm(n, m)',
    share: 'n / (n + m)',
    avg: '(n + m + k + q) / 4',
    big: 'max(n, m, k, q) - min(n, m, k, q) + floor(p / 1000) + ceil(r / 4)',
  },
  constraints: [
    'n != m',
    'g > 1 or k > 2',
    'diff >= 0',
    'share < 1',
    'not avg == 0',
    'l <= n * m',
    'r + t > 3',
    'big >= 0',
  ],
  stem: `[synthetic] ${'A sum of {{p}} at {{r}}% for {{t}} years gives {{ci:2}}; {{n}} and {{m}} {{unit}}. '.repeat(36)}`,
  options: [
    { id: 'a', text: '{{diff:2}}' },
    { id: 'b', text: '{{si:2}}' },
    { id: 'c', text: '{{ci:2}} ({{share:2}})' },
    { id: 'd', text: '{{g}} / {{l}}' },
    { id: 'e', text: '{{avg:2}} {{unit}}' },
    { id: 'f', text: '{{big}} [{{k}}, {{q}}]' },
  ],
  correctOptionId: 'a',
  count: 200,
};

describe('the work meter (security High)', () => {
  it('has a per-tuple and a per-generation budget', () => {
    expect(TUPLE_WORK_BUDGET).toBeGreaterThan(0);
    expect(GENERATION_WORK_BUDGET).toBeGreaterThan(TUPLE_WORK_BUDGET);
  });

  it('a realistic maximal spec (count 200) is accepted and generates inside the budget', () => {
    expect(validateParamSpec(MAXIMAL)).toEqual({ ok: true });
    const result = generateVariants(MAXIMAL, seedsFor(200));
    expect(result.ok).toBe(true);
  });

  it('the adversarial spec at its full size fails with a typed result, deterministically', () => {
    for (const count of [5, 200]) {
      const spec = adversarial(2 ** 27, 2 ** 28, count);
      expect(validateParamSpec(spec)).toEqual({ ok: true });
      const result = generateVariants(spec, seedsFor(count));
      expect(result).toMatchObject({ ok: false, code: 'variant_generation_failed' });
      expect(generateVariants(spec, seedsFor(count))).toEqual(result);
    }
  });

  it('a smaller adversarial spec whose values fit the size bound stops on the work budget', () => {
    for (const count of [5, 200]) {
      const spec = adversarial(2 ** 5, 2 ** 6, count);
      expect(validateParamSpec(spec)).toEqual({ ok: true });
      const result = generateVariants(spec, seedsFor(count));
      expect(result).toEqual({
        ok: false,
        code: 'variant_generation_failed',
        reason: 'work_budget',
        accepted: 0,
        attempts: 1,
      });
    }
  });

  it('many cheap-but-rejected tuples are bounded by the generation budget too', () => {
    // Each tuple stays under the tuple budget, every tuple is rejected (equal options), count 200.
    const spec: ParamSpec = {
      ...adversarial(2 ** 5, 2 ** 6, 200),
      derived: { a: '((p/(p+1))^6)^6', d1: balanced('a', 50) },
      constraints: [`${balanced('a', 50)}>=0`],
      stem: '[synthetic] {{a:4}}',
      options: [
        { id: 'o0', text: '{{a:2}}' },
        { id: 'o1', text: '{{a:2}}' },
      ],
    };
    const result = generateVariants(spec, seedsFor(200));
    expect(result).toMatchObject({ ok: false, code: 'variant_generation_failed' });
    if (!result.ok && result.code === 'variant_generation_failed') {
      expect(['work_budget', 'attempts']).toContain(result.reason);
    }
  });
});

describe('rendering never throws for an accepted spec (security Medium)', () => {
  it.each<[string, number, number, string]>([
    ['the review repro: (p^6)^6 * 1000, p near 2^28', 2 ** 28 - 8, 2 ** 28, '(p^6)^6*1000'],
    ['a value just under the size bound times 10^4', 120, 127, '(p^6)^6'],
  ])('%s', (_label, min, max, expr) => {
    const spec: ParamSpec = {
      params: { p: { kind: 'int', min, max, step: 1 } },
      derived: { a: expr, b: 'p + 1' },
      constraints: [],
      stem: '[synthetic] {{a:4}}',
      options: [
        { id: 'a', text: '{{p}}' },
        { id: 'b', text: '{{b}}' },
      ],
      correctOptionId: 'a',
      count: 5,
    };
    expect(validateParamSpec(spec)).toEqual({ ok: true });
    let result: ReturnType<typeof generateVariants> | undefined;
    expect(() => {
      result = generateVariants(spec, seedsFor(5));
    }).not.toThrow();
    expect(result).toMatchObject({ ok: false, code: 'variant_generation_failed' });
  });
});

describe('stored JSON byte limits (database Low)', () => {
  const rupeeOptions = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `o${i}`, text: `${'₹'.repeat(494)}${i}{{a}}` }));
  const base = (options: ParamSpec['options']): ParamSpec => ({
    params: { a: { kind: 'int', min: 1, max: 9, step: 1 } },
    derived: {},
    constraints: [],
    stem: '[synthetic] {{a}}',
    options,
    correctOptionId: 'o0',
    count: 5,
  });

  it('options whose jsonb text exceeds 8192 bytes are rejected; five such options fit', () => {
    expect(generateVariants(base(rupeeOptions(6)), seedsFor(5))).toMatchObject({
      ok: false,
      code: 'variant_generation_failed',
      reason: 'attempts',
    });
    expect(generateVariants(base(rupeeOptions(5)), seedsFor(5)).ok).toBe(true);
  });

  const textParams = (n: number): ParamSpec => {
    const params: ParamSpec['params'] = {};
    for (let i = 0; i < n; i += 1) {
      params[`t${i}`] = { kind: 'choice', values: ['₹'.repeat(100), '€'.repeat(100)] };
    }
    return {
      params,
      derived: {},
      constraints: [],
      stem: `[synthetic] ${Array.from({ length: n }, (_, i) => `{{t${i}}}`).join(' ')}`,
      options: [
        { id: 'o0', text: '[synthetic] yes' },
        { id: 'o1', text: '[synthetic] no' },
      ],
      correctOptionId: 'o0',
      count: 5,
    };
  };

  it('params whose jsonb text exceeds 2048 bytes are rejected; six such params fit', () => {
    expect(generateVariants(textParams(8), seedsFor(5))).toMatchObject({
      ok: false,
      code: 'variant_generation_failed',
      reason: 'attempts',
    });
    expect(generateVariants(textParams(6), seedsFor(5)).ok).toBe(true);
  });
});
