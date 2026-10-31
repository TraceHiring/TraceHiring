// The §6.3 expression grammar (specs/m1-test-authoring.md §6.3, AT-M1-04): a hand-written Pratt parser that accepts
// exactly the grammar and refuses everything else with a typed error, and an exact evaluator. Specs are data: the
// package never runs a string as code (check-boundaries rule 12 scans this file too, so the refuse table below
// builds the forbidden words by concatenation, R5-52 d).
import { describe, expect, it } from 'vitest';
import {
  EvalRejection,
  ExprError,
  MAX_EXPR_DEPTH,
  MAX_EXPR_LENGTH,
  evaluate,
  parseExpression,
  type ExprMode,
} from './expr.js';
import { parseDecimal, rational, type Rational } from './rational.js';

const r = (n: number, d = 1) => rational(BigInt(n), BigInt(d));
const env = (values: Record<string, Rational>) => new Map(Object.entries(values));
const ENV = env({ a: r(6), b: r(4), c: r(3), z: r(0) });
const value = (src: string, e = ENV) => evaluate(parseExpression(src, 'value'), e);
const holds = (src: string, e = ENV) => evaluate(parseExpression(src, 'constraint'), e);

const parseCode = (src: string, mode: ExprMode): string => {
  try {
    parseExpression(src, mode);
  } catch (error) {
    expect(error).toBeInstanceOf(ExprError);
    return (error as ExprError).code;
  }
  return 'accepted';
};
const rejectCode = (src: string, e = ENV): string => {
  try {
    value(src, e);
  } catch (error) {
    expect(error).toBeInstanceOf(EvalRejection);
    return (error as EvalRejection).code;
  }
  return 'accepted';
};
const nested = (depth: number) => `${'abs('.repeat(depth)}a${')'.repeat(depth)}`;

describe('parseExpression accepts the §6.3 grammar', () => {
  const VALUE_OK = [
    '1',
    '1.5',
    '0.000001',
    'a + b * c',
    '(a + b) * c',
    'a^0',
    'a^6',
    '-a',
    '- -a',
    'a - -b',
    'min(a, b)',
    'max(a, b, c)',
    'abs(a - b)',
    'round(a / 7, 2)',
    'floor(a / 4)',
    'ceil(a / 4)',
    'gcd(a, b)',
    'lcm(a, b)',
    'abcdefghijklmnop',
    'x_1 + y2',
    'a\t+\tb',
  ];
  it.each(VALUE_OK)('value %j', (src) => {
    expect(parseCode(src, 'value')).toBe('accepted');
  });

  const CONSTRAINT_OK = [
    'a < b',
    'a <= b and b != 3',
    'not a == b',
    'a > 1 or b >= 2',
    '(a < b) and (b < c)',
    'not (a < b or b < c)',
    'gcd(a, b) == 1',
  ];
  it.each(CONSTRAINT_OK)('constraint %j', (src) => {
    expect(parseCode(src, 'constraint')).toBe('accepted');
  });

  it('accepts exactly the length and depth caps', () => {
    expect(MAX_EXPR_LENGTH).toBe(200);
    expect(MAX_EXPR_DEPTH).toBe(16);
    const longest = `${'1+'.repeat(99)}11`;
    expect(longest.length).toBe(200);
    // A flat sum is deep too (the depth is the tree's height), so the length check is tried on a shallow shape.
    const longArgs = Array.from({ length: 8 }, () => 'abcdefghijklmnop').join(', ');
    expect(`min(${longArgs}) + ${'1'.repeat(50)}`.length).toBe(200);
    expect(parseCode(`min(${longArgs}) + ${'1'.repeat(50)}`, 'value')).toBe('accepted');
    expect(parseCode(nested(MAX_EXPR_DEPTH - 1), 'value')).toBe('accepted');
  });
});

describe('parseExpression refuses everything else with a typed error', () => {
  const evalWord = 'ev' + 'al';
  const fnWord = 'Func' + 'tion';
  const ctorWord = 'con' + 'structor';
  const REFUSE: [string, ExprMode, string][] = [
    ['', 'value', 'empty'],
    ['   ', 'value', 'empty'],
    [`${'1+'.repeat(100)}1`, 'value', 'too_long'],
    ['1.1234567', 'value', 'bad_number'],
    ['1'.repeat(100), 'value', 'bad_number'],
    ['1.', 'value', 'bad_number'],
    ['1..2', 'value', 'bad_number'],
    ['.5', 'value', 'bad_char'],
    ['abcdefghijklmnopq', 'value', 'bad_name'],
    ['A', 'value', 'bad_char'],
    ['_a', 'value', 'bad_char'],
    ['a $ b', 'value', 'bad_char'],
    ['a % b', 'value', 'bad_char'],
    ['"x"', 'value', 'bad_char'],
    ['a.b', 'value', 'bad_char'],
    ['a = b', 'constraint', 'bad_char'],
    ['a ! b', 'constraint', 'bad_char'],
    ['a && b', 'constraint', 'bad_char'],
    ['a\nb', 'value', 'bad_char'],
    ['a ^ 7', 'value', 'bad_exponent'],
    ['a ^ b', 'value', 'bad_exponent'],
    ['a ^ 1.5', 'value', 'bad_exponent'],
    ['a ^ -1', 'value', 'bad_exponent'],
    ['2 ^ 3 ^ 2', 'value', 'bad_exponent'],
    ['sqrt(a)', 'value', 'unknown_function'],
    [`${evalWord}(1)`, 'value', 'unknown_function'],
    [`${fnWord}(1)`, 'value', 'bad_char'],
    [`a.${ctorWord}(1)`, 'value', 'bad_char'],
    [`a['${ctorWord}']`, 'value', 'bad_char'],
    ['min(a)', 'value', 'bad_arity'],
    ['min()', 'value', 'bad_arity'],
    [`max(${Array.from({ length: 9 }, () => 'a').join(', ')})`, 'value', 'bad_arity'],
    ['abs(a, b)', 'value', 'bad_arity'],
    ['gcd(a)', 'value', 'bad_arity'],
    ['round(a)', 'value', 'bad_arity'],
    ['round(a, b)', 'value', 'bad_round_digits'],
    ['round(a, 7)', 'value', 'bad_round_digits'],
    ['round(a, 1.5)', 'value', 'bad_round_digits'],
    ['min', 'value', 'reserved_name'],
    ['a + max', 'value', 'reserved_name'],
    ['a < b', 'value', 'not_allowed'],
    ['not a', 'value', 'not_allowed'],
    ['a and b', 'value', 'not_allowed'],
    ['a + b', 'constraint', 'type_mismatch'],
    ['(a < b) + 1', 'constraint', 'type_mismatch'],
    ['not a', 'constraint', 'type_mismatch'],
    ['a and b', 'constraint', 'type_mismatch'],
    ['min(a < b, c)', 'constraint', 'type_mismatch'],
    ['a < b < c', 'constraint', 'comparison_chain'],
    ['a == b != c', 'constraint', 'comparison_chain'],
    ['(a', 'value', 'unexpected_end'],
    ['a +', 'value', 'unexpected_end'],
    ['a)', 'value', 'unexpected_token'],
    ['a b', 'value', 'unexpected_token'],
    ['2a', 'value', 'unexpected_token'],
    ['()', 'value', 'unexpected_token'],
    ['min(a,)', 'value', 'unexpected_token'],
    ['a,b', 'value', 'unexpected_token'],
    ['and', 'constraint', 'unexpected_token'],
    [nested(MAX_EXPR_DEPTH), 'value', 'too_deep'],
    [`${'1+'.repeat(16)}1`, 'value', 'too_deep'],
  ];
  it.each(REFUSE)('%j (%s) -> %s', (src, mode, code) => {
    expect(parseCode(src, mode)).toBe(code);
  });

  it('names a position and never echoes the input', () => {
    try {
      parseExpression('a + secretword $', 'value');
      throw new Error('accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(ExprError);
      expect((error as ExprError).at).toBe(15);
      expect((error as Error).message).not.toContain('secretword');
    }
  });

  it('refuses a non-string input', () => {
    expect(parseCode(42 as unknown as string, 'value')).toBe('empty');
  });
});

describe('evaluate is exact', () => {
  it('arithmetic and precedence', () => {
    expect(value('a + b * c')).toEqual(r(18));
    expect(value('(a + b) * c')).toEqual(r(30));
    expect(value('a - b - c')).toEqual(r(-1));
    expect(value('a / b / c')).toEqual(r(1, 2));
    expect(value('-2^2')).toEqual(r(-4));
    expect(value('(-2)^2')).toEqual(r(4));
    expect(value('1/3 + 1/6')).toEqual(r(1, 2));
    expect(value('0.1 + 0.2')).toEqual(parseDecimal('0.3'));
  });

  it('functions', () => {
    expect(value('min(a, b, c)')).toEqual(r(3));
    expect(value('max(a, b, c)')).toEqual(r(6));
    expect(value('abs(b - a)')).toEqual(r(2));
    expect(value('round(a / 7, 2)')).toEqual(parseDecimal('0.86'));
    expect(value('round(2.5, 0)')).toEqual(r(3));
    expect(value('round(-2.5, 0)')).toEqual(r(-3));
    expect(value('floor(-7 / 2)')).toEqual(r(-4));
    expect(value('ceil(7 / 2)')).toEqual(r(4));
    expect(value('gcd(a, b)')).toEqual(r(2));
    expect(value('lcm(a, b)')).toEqual(r(12));
    expect(value('gcd(z, z)')).toEqual(r(0));
    expect(value('lcm(a, z)')).toEqual(r(0));
    expect(value('gcd(-a, b)')).toEqual(r(2));
  });

  it('constraints, with no short-circuit', () => {
    expect(holds('a > b and b > c')).toBe(true);
    expect(holds('a < b or not b == 4')).toBe(false);
    expect(holds('a != b')).toBe(true);
    expect(holds('0.1 + 0.2 == 0.3')).toBe(true);
    // Every operand is evaluated: a division by zero on the right still rejects the tuple.
    expect(() => holds('a > 0 or 1 / z > 0')).toThrow(EvalRejection);
  });

  it('rejects the tuple on division by zero, a non-integer gcd, a huge value or an unknown name', () => {
    expect(rejectCode('1 / z')).toBe('division_by_zero');
    expect(rejectCode('1 / (a - a)')).toBe('division_by_zero');
    expect(rejectCode('gcd(1.5, 3)')).toBe('not_integer');
    expect(rejectCode('lcm(a / 4, 3)')).toBe('not_integer');
    expect(rejectCode('((((((((2^6)^6)^6)^6)^6)^6)^6)^6)')).toBe('too_large');
    expect(rejectCode('q + 1')).toBe('unknown_name');
  });

  // Lead note (security review of the M1 contracts): ParamName accepts names that exist on Object.prototype. They
  // behave exactly like any other name, and an unbound one is a typed rejection, never a prototype value.
  const PROTO_NAMES = [
    'constructor',
    'prototype',
    'hasownproperty',
    'isprototypeof',
    'valueof',
    'tostring',
  ];
  it.each(PROTO_NAMES)('the name %j is an ordinary name', (name) => {
    expect(parseCode(`${name} + 1`, 'value')).toBe('accepted');
    expect(rejectCode(`${name} + 1`)).toBe('unknown_name');
    expect(rejectCode(`${name} + 1`, env({}))).toBe('unknown_name');
    const bound = new Map<string, Rational>([[name, r(41)]]);
    expect(value(`${name} + 1`, bound)).toEqual(r(42));
    expect(holds(`${name} == 41`, bound)).toBe(true);
  });
});
