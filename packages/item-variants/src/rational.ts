// Exact rational arithmetic on bigint (specs/m1-test-authoring.md §6.3). A value is a numerator and a denominator,
// always reduced with a positive denominator, so equal values have equal representations and compare with ===.
// Pure: no I/O, no clock, no randomness.

export interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}

export type RationalErrorCode = 'division_by_zero' | 'not_integer' | 'too_large';

/** A value the arithmetic refuses. The caller rejects the parameter tuple that produced it (§6.3). */
export class RationalError extends Error {
  readonly code: RationalErrorCode;
  constructor(code: RationalErrorCode) {
    super(`rational: ${code}`);
    this.name = 'RationalError';
    this.code = code;
  }
}

/**
 * Numerators and denominators stay within 1024 bits (about 308 decimal digits). A quant item never needs more, and
 * the bound keeps nested powers such as `((2^6)^6)^6` from exhausting memory: a bigger value rejects the tuple.
 */
export const MAX_BITS = 1024;

const babs = (x: bigint): bigint => (x < 0n ? -x : x);
const bitLength = (x: bigint): number => (x === 0n ? 0 : babs(x).toString(2).length);

/** Greatest common divisor of |a| and |b|; gcd(0, 0) = 0. */
export function bigGcd(a: bigint, b: bigint): bigint {
  let x = babs(a);
  let y = babs(b);
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** The reduced value n / d. Throws RationalError on d = 0 or a value beyond MAX_BITS. */
export function rational(n: bigint, d: bigint = 1n): Rational {
  if (d === 0n) throw new RationalError('division_by_zero');
  let num = n;
  let den = d;
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = bigGcd(num, den);
  if (g > 1n) {
    num /= g;
    den /= g;
  }
  if (bitLength(num) > MAX_BITS || bitLength(den) > MAX_BITS) {
    throw new RationalError('too_large');
  }
  return { n: num, d: den };
}

export const ZERO: Rational = { n: 0n, d: 1n };
export const ONE: Rational = { n: 1n, d: 1n };

export const add = (a: Rational, b: Rational): Rational =>
  rational(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rational, b: Rational): Rational =>
  rational(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rational, b: Rational): Rational => rational(a.n * b.n, a.d * b.d);
export function div(a: Rational, b: Rational): Rational {
  if (b.n === 0n) throw new RationalError('division_by_zero');
  return rational(a.n * b.d, a.d * b.n);
}
export const neg = (a: Rational): Rational => ({ n: -a.n, d: a.d });
export const abs = (a: Rational): Rational => (a.n < 0n ? neg(a) : a);

/** a^e for an integer exponent 0..6 (the grammar's bound); 0^0 = 1. */
export function pow(a: Rational, e: number): Rational {
  if (!Number.isInteger(e) || e < 0 || e > 6) throw new RationalError('not_integer');
  const be = BigInt(e);
  return rational(a.n ** be, a.d ** be);
}

/** -1, 0 or 1 as a is below, equal to or above b. */
export function compare(a: Rational, b: Rational): -1 | 0 | 1 {
  const diff = a.n * b.d - b.n * a.d;
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

export const isInteger = (a: Rational): boolean => a.d === 1n;

/** The largest integer not above a. */
export function floor(a: Rational): Rational {
  let q = a.n / a.d;
  if (a.n % a.d !== 0n && a.n < 0n) q -= 1n;
  return rational(q);
}

/** The smallest integer not below a. */
export const ceil = (a: Rational): Rational => neg(floor(neg(a)));

/** a rounded to `digits` decimals, halves away from zero (2.5 -> 3, -2.5 -> -3, 1.005 -> 1.01 at 2). */
export function roundHalfAway(a: Rational, digits: number): Rational {
  const scale = 10n ** BigInt(digits);
  const y = mul(a, rational(scale));
  const m = (2n * babs(y.n) + y.d) / (2n * y.d);
  return rational(y.n < 0n ? -m : m, scale);
}

/** A decimal literal of the grammar (digits, optionally a point and more digits) as an exact value. */
export function parseDecimal(text: string): Rational {
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(text);
  if (match === null) throw new RationalError('not_integer');
  const frac = match[2] ?? '';
  return rational(BigInt(`${match[1]!}${frac}`), 10n ** BigInt(frac.length));
}

/** a rounded half away from zero and printed with exactly `places` decimals; never prints "-0". */
export function toFixed(a: Rational, places: number): string {
  const rounded = roundHalfAway(a, places);
  const scale = 10n ** BigInt(places);
  const v = rounded.n * (scale / rounded.d);
  const digits = babs(v)
    .toString()
    .padStart(places + 1, '0');
  const text = places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`;
  return v < 0n ? `-${text}` : text;
}

/** a printed exactly with the fewest decimals, or null when it needs more than `maxPlaces` (e.g. 1/3). */
export function toExactDecimal(a: Rational, maxPlaces: number): string | null {
  for (let p = 0; p <= maxPlaces; p += 1) {
    if ((a.n * 10n ** BigInt(p)) % a.d === 0n) return toFixed(a, p);
  }
  return null;
}
