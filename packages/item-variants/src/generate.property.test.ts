// AT-M1-04 property (specs/m1-test-authoring.md §12): every generated variant satisfies its constraints and its key is
// one of its options; generation is deterministic in its seeds. fast-check builds synthetic specs from small pieces.
import type { ParamSpec } from '@trace/shared/contracts/m1';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluate, parseExpression } from './expr.js';
import { generateVariants } from './generate.js';
import { rational, type Rational } from './rational.js';

const RUNS = { numRuns: 150 };

const DERIVED = ['a + b', 'a * b', 'a - b', 'a / b', 'gcd(a, b)', 'max(a, b) - min(a, b)', 'a ^ 2'];
const CONSTRAINTS = [
  'a != b',
  'a < b',
  'a + b > 5',
  'gcd(a, b) == 1',
  'not a == 0',
  'a > 0 or b > 0',
];
const FORMATS = ['', ':0', ':2', ':4', ':%'];

const arbSpec: fc.Arbitrary<ParamSpec> = fc
  .record({
    aMin: fc.integer({ min: -20, max: 20 }),
    aSpan: fc.integer({ min: 0, max: 30 }),
    aStep: fc.integer({ min: 1, max: 4 }),
    bValues: fc.uniqueArray(fc.integer({ min: -10, max: 40 }), { minLength: 1, maxLength: 8 }),
    derived: fc.uniqueArray(fc.constantFrom(...DERIVED), { minLength: 2, maxLength: 4 }),
    constraints: fc.uniqueArray(fc.constantFrom(...CONSTRAINTS), { maxLength: 3 }),
    formats: fc.array(fc.constantFrom(...FORMATS), { minLength: 4, maxLength: 4 }),
    optionCount: fc.integer({ min: 2, max: 4 }),
    correct: fc.nat(),
    count: fc.integer({ min: 5, max: 8 }),
  })
  .map((g) => {
    const derived: Record<string, string> = {};
    g.derived.forEach((src, i) => {
      derived[`d${i}`] = src;
    });
    const names = Object.keys(derived);
    const options = Array.from({ length: g.optionCount }, (_, i) => ({
      id: `o${i}`,
      text: `{{${names[i % names.length]!}${g.formats[i]!}}} [${i < names.length ? 'x' : i}]`,
    }));
    return {
      params: {
        a: { kind: 'int' as const, min: g.aMin, max: g.aMin + g.aSpan, step: g.aStep },
        b: { kind: 'choice' as const, values: g.bValues },
      },
      derived,
      constraints: g.constraints,
      stem: '[synthetic] Given {{a}} and {{b}}',
      options,
      correctOptionId: options[g.correct % options.length]!.id,
      count: g.count,
    };
  });

const arbSeeds = (count: number) =>
  fc.array(fc.uint8Array({ minLength: 16, maxLength: 32 }), { minLength: count, maxLength: count });

const toEnv = (params: Readonly<Record<string, number | string>>): Map<string, Rational> =>
  new Map(Object.entries(params).map(([k, v]) => [k, rational(BigInt(v as number))]));

describe('generateVariants properties (AT-M1-04)', () => {
  it('every variant satisfies its constraints and its key is one of its options', () => {
    fc.assert(
      fc.property(
        arbSpec.chain((spec) => fc.tuple(fc.constant(spec), arbSeeds(spec.count))),
        ([spec, seeds]) => {
          const result = generateVariants(spec, seeds);
          if (!result.ok) {
            expect(result.code).toBe('variant_generation_failed');
            return;
          }
          expect(result.variants).toHaveLength(spec.count);
          const seen = new Set<string>();
          for (const v of result.variants) {
            const env = toEnv(v.params);
            for (const src of spec.constraints) {
              expect(evaluate(parseExpression(src, 'constraint'), env)).toBe(true);
            }
            const ids = v.options.map((o) => o.id);
            expect(ids).toContain(v.correctOptionId);
            expect(v.correctOptionId).toBe(spec.correctOptionId);
            expect(ids).toEqual(spec.options.map((o) => o.id));
            const texts = v.options.map((o) => o.text.trim().replace(/\s+/g, ' '));
            expect(new Set(texts).size).toBe(texts.length);
            const a = v.params['a'] as number;
            const defA = spec.params['a'];
            const defB = spec.params['b'];
            if (defA?.kind !== 'int' || defB?.kind !== 'choice') throw new Error('spec shape');
            expect(a >= defA.min && a <= defA.max && (a - defA.min) % defA.step === 0).toBe(true);
            expect(defB.values).toContain(v.params['b']);
            const key = JSON.stringify([v.stem, v.options]);
            expect(seen.has(key)).toBe(false);
            seen.add(key);
          }
        },
      ),
      RUNS,
    );
  });

  it('the same spec and seeds give the same result', () => {
    fc.assert(
      fc.property(
        arbSpec.chain((spec) => fc.tuple(fc.constant(spec), arbSeeds(spec.count))),
        ([spec, seeds]) => {
          const copy = seeds.map((s) => Uint8Array.from(s));
          expect(generateVariants(structuredClone(spec), copy)).toEqual(
            generateVariants(spec, seeds),
          );
        },
      ),
      RUNS,
    );
  });
});
