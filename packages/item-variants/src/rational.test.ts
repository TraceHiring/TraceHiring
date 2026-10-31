// Exact rational arithmetic (specs/m1-test-authoring.md §6.3, AT-M1-04): bigint numerator and denominator, always
// reduced with a positive denominator, so equal values compare and print equal.
import { describe, expect, it } from 'vitest';
import {
  MAX_BITS,
  RationalError,
  add,
  ceil,
  compare,
  div,
  floor,
  mul,
  parseDecimal,
  pow,
  rational,
  roundHalfAway,
  sub,
  toExactDecimal,
  toFixed,
} from './rational.js';

const r = (n: number, d = 1) => rational(BigInt(n), BigInt(d));
const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(RationalError);
    return (error as RationalError).code;
  }
  throw new Error('expected a RationalError');
};

describe('rational', () => {
  it('normalises sign and common factors', () => {
    expect(r(2, 4)).toEqual({ n: 1n, d: 2n });
    expect(r(3, -6)).toEqual({ n: -1n, d: 2n });
    expect(r(0, -7)).toEqual({ n: 0n, d: 1n });
  });

  it('is exact where binary floating point is not', () => {
    const sum = add(parseDecimal('0.1'), parseDecimal('0.2'));
    expect(compare(sum, parseDecimal('0.3'))).toBe(0);
    expect(add(r(1, 3), r(1, 6))).toEqual(r(1, 2));
    expect(sub(r(1, 2), r(1, 3))).toEqual(r(1, 6));
    expect(mul(r(2, 3), r(9, 4))).toEqual(r(3, 2));
    expect(div(r(1, 2), r(1, 4))).toEqual(r(2));
  });

  it('refuses division by zero', () => {
    expect(codeOf(() => div(r(1), r(0)))).toBe('division_by_zero');
    expect(codeOf(() => rational(1n, 0n))).toBe('division_by_zero');
  });

  it('powers, floors and ceilings are exact', () => {
    expect(pow(r(-2, 3), 3)).toEqual(r(-8, 27));
    expect(pow(r(0), 0)).toEqual(r(1));
    expect(floor(r(7, 2))).toEqual(r(3));
    expect(floor(r(-7, 2))).toEqual(r(-4));
    expect(ceil(r(7, 2))).toEqual(r(4));
    expect(ceil(r(-7, 2))).toEqual(r(-3));
    expect(floor(r(-4))).toEqual(r(-4));
  });

  it('rounds half away from zero at a number of decimals', () => {
    expect(roundHalfAway(r(5, 2), 0)).toEqual(r(3));
    expect(roundHalfAway(r(-5, 2), 0)).toEqual(r(-3));
    expect(roundHalfAway(parseDecimal('1.005'), 2)).toEqual(parseDecimal('1.01'));
    expect(roundHalfAway(r(1, 3), 4)).toEqual(parseDecimal('0.3333'));
  });

  it('parses decimals of up to six places', () => {
    expect(parseDecimal('12.345')).toEqual(r(2469, 200));
    expect(parseDecimal('0.000001')).toEqual(r(1, 1_000_000));
    expect(parseDecimal('007')).toEqual(r(7));
  });

  it('prints fixed decimals without a negative zero', () => {
    expect(toFixed(r(1, 3), 2)).toBe('0.33');
    expect(toFixed(r(2, 3), 0)).toBe('1');
    expect(toFixed(r(-1, 1000), 2)).toBe('0.00');
    expect(toFixed(r(-5, 4), 1)).toBe('-1.3');
    expect(toFixed(r(12), 3)).toBe('12.000');
  });

  it('prints an exact decimal only when it terminates within the places allowed', () => {
    expect(toExactDecimal(r(1, 8), 6)).toBe('0.125');
    expect(toExactDecimal(r(-42), 6)).toBe('-42');
    expect(toExactDecimal(r(1, 3), 6)).toBeNull();
    expect(toExactDecimal(r(1, 128), 6)).toBeNull();
  });

  it('refuses values beyond the size bound (so nested powers cannot exhaust memory)', () => {
    let x = r(2);
    expect(MAX_BITS).toBe(256);
    expect(
      codeOf(() => {
        for (let i = 0; i < 10; i += 1) x = pow(x, 6);
      }),
    ).toBe('too_large');
  });
});
