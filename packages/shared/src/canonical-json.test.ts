// canonicalJson (specs/d1-demo-slice.md §5.1, §5.2): sorted keys, no whitespace. Synthetic values only.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json.js';

describe('canonicalJson', () => {
  it('matches the fixed vector', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 'x' }] })).toBe('{"a":[{"c":"x","d":2}],"b":1}');
  });
  it('is independent of key insertion order', () => {
    expect(canonicalJson({ a: 1, b: 2, c: 3 })).toBe(canonicalJson({ c: 3, b: 2, a: 1 }));
    expect(canonicalJson({ x: { b: 1, a: 2 }, y: 0 })).toBe(
      canonicalJson({ y: 0, x: { a: 2, b: 1 } }),
    );
  });
  it('sorts nested objects and keeps array order', () => {
    expect(canonicalJson([{ z: 1, a: [3, 1, 2] }, 'b', null])).toBe(
      '[{"a":[3,1,2],"z":1},"b",null]',
    );
  });
  it('sorts keys by UTF-16 code unit order', () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3, é: 4, '10': 5, '9': 6 })).toBe(
      '{"10":5,"9":6,"B":2,"a":3,"b":1,"é":4}',
    );
  });
  it('writes primitives as JSON.stringify does', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(0)).toBe('0');
    expect(canonicalJson(-1.5)).toBe('-1.5');
    expect(canonicalJson('he said "hi"\n')).toBe(JSON.stringify('he said "hi"\n'));
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson([])).toBe('[]');
  });
  it('has no whitespace outside strings', () => {
    expect(canonicalJson({ a: [1, { b: 'x y' }] })).toBe('{"a":[1,{"b":"x y"}]}');
  });
  it.each([
    ['undefined', undefined],
    ['a function', () => 1],
    ['a symbol', Symbol('s')],
    ['a bigint', 1n],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['undefined in an object', { a: undefined }],
    ['undefined in an array', [undefined]],
    ['a function nested', { a: { b: () => 1 } }],
    ['NaN nested', [{ a: Number.NaN }]],
  ])('throws on %s', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow();
  });
  it('pins the SHA-256 of the d1-v1 rule table', () => {
    const path = resolve(
      import.meta.dirname,
      '../../..',
      'docs/progress/d1-wave0-drafts/m3/d1-v1.json',
    );
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const hash = createHash('sha256').update(canonicalJson(parsed)).digest('hex');
    expect(hash).toBe('c862bf653c6284fbb4d2319c923cd1c8aa28bcc40a2a61ccbc10d6e6af96ca0e');
  });
});
