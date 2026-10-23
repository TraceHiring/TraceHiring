// Work-meter round 2 (A1 re-review): Euclid's gcd on consecutive Fibonacci numbers takes hundreds of steps at 256
// bits, so it is charged per step (security Medium F1); comparisons, min/max arguments and every evaluated node are
// charged too (security Low F2). Each adversarial spec below is accepted by validateParamSpec and must stop on the
// deterministic budget. Synthetic content only.
import type { ParamSpec } from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import { generateVariants, validateParamSpec } from './generate.js';

const seedsFor = (count: number): Uint8Array[] =>
  Array.from({ length: count }, (_, k) =>
    Uint8Array.from({ length: 32 }, (_, i) => (k * 29 + i * 11 + 5) % 256),
  );

const fib = (n: number): bigint => {
  let a = 0n;
  let b = 1n;
  for (let i = 0; i < n; i += 1) [a, b] = [b, a + b];
  return a;
};

/** A balanced sum of `n` copies of `term`, without the outer parentheses. */
function balanced(term: string, n: number): string {
  const go = (k: number): string =>
    k === 1 ? term : `(${go(Math.floor(k / 2))}+${go(Math.ceil(k / 2))})`;
  return go(n).slice(1, -1);
}

/** F(k), F(k+1) as params; doubling rounds give consecutive Fibonacci numbers, then many gcd calls on them. */
function fibonacciSpec(k: number, rounds: 2 | 3, count: number): ParamSpec {
  const derived: Record<string, string> = {
    a: 'f*(2*g-f)',
    b: 'f^2+g^2',
    u: 'a*(2*b-a)',
    v: 'a^2+b^2',
  };
  let x = 'u';
  let y = 'v';
  if (rounds === 3) {
    derived['s'] = 'u*(2*v-u)';
    derived['t'] = 'u^2+v^2';
    x = 's';
    y = 't';
  }
  const sum = balanced(`gcd(${x},${y})`, 16);
  const extra = rounds === 3 ? 2 : 4;
  for (let i = 0; i < extra; i += 1) derived[`h${i}`] = sum;
  return {
    params: {
      f: { kind: 'choice', values: [Number(fib(k))] },
      g: { kind: 'choice', values: [Number(fib(k + 1))] },
    },
    derived,
    constraints: Array.from({ length: 8 }, () => `${sum}>=0`),
    stem: '[synthetic] {{f}}',
    options: [
      { id: 'o0', text: '[synthetic] {{f}}' },
      { id: 'o1', text: '[synthetic] {{g}}' },
    ],
    correctOptionId: 'o0',
    count,
  };
}

describe('gcd is charged per Euclid step (F1)', () => {
  it('the fixtures are the Fibonacci numbers the review named', () => {
    expect(Number.isSafeInteger(Number(fib(78)))).toBe(true);
    expect(fib(309).toString(2).length).toBeLessThanOrEqual(256);
    expect(fib(369).toString(2).length).toBeLessThanOrEqual(256);
    expect(fib(369).toString(2).length).toBeGreaterThan(250);
  });

  it.each<[string, number, 2 | 3]>([
    ['F77/F78 doubled twice (F308, F309)', 77, 2],
    ['F46/F47 doubled three times (F368, F369, about 254 bits)', 46, 3],
  ])('%s stops on the work budget on its first tuple', (_label, k, rounds) => {
    for (const count of [5, 200]) {
      const spec = fibonacciSpec(k, rounds, count);
      expect(validateParamSpec(spec)).toEqual({ ok: true });
      expect(generateVariants(spec, seedsFor(count))).toEqual({
        ok: false,
        code: 'variant_generation_failed',
        reason: 'work_budget',
        accepted: 0,
        attempts: 1,
      });
    }
  });
});

describe('comparisons and evaluated nodes are charged (F2)', () => {
  it('an all-rejected spec of 8-argument min/max stops on the work budget, not the attempts cap', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const inner = `max(${names.join(',')})`;
    const outer = `min(${Array.from({ length: 8 }, () => inner).join(',')})`;
    expect(outer.length).toBeLessThanOrEqual(196);
    const params: ParamSpec['params'] = {};
    for (const n of names) params[n] = { kind: 'int', min: 1, max: 1000, step: 1 };
    const derived: Record<string, string> = {};
    for (let i = 0; i < 8; i += 1) derived[`m${i}`] = outer;
    const spec: ParamSpec = {
      params,
      derived,
      constraints: Array.from({ length: 8 }, () => `${outer}>=0`),
      stem: '[synthetic] {{a}}',
      // Equal options: every tuple is rejected after its evaluation.
      options: [
        { id: 'o0', text: '{{m0}}' },
        { id: 'o1', text: '{{m1}}' },
      ],
      correctOptionId: 'o0',
      count: 200,
    };
    expect(validateParamSpec(spec)).toEqual({ ok: true });
    expect(generateVariants(spec, seedsFor(200))).toMatchObject({
      ok: false,
      code: 'variant_generation_failed',
      reason: 'work_budget',
    });
  });
});
