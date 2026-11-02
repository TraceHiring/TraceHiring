// canonicalJson (specs/d1-demo-slice.md §5.2, §5.1 n-4): the band engine keeps its own copy for purity. The vectors
// below are the ones of packages/shared/src/canonical-json.test.ts and scripts/test/band-rules-sync.test.mjs, so the
// two implementations are pinned to the same outputs (the engine may not import @trace/shared).
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './index.js';

describe('canonicalJson (band engine copy)', () => {
  it('matches the shared fixed vectors', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 'x' }] })).toBe('{"a":[{"c":"x","d":2}],"b":1}');
    expect(canonicalJson({ b: [1, { z: 1, a: 'x' }], a: null })).toBe(
      '{"a":null,"b":[1,{"a":"x","z":1}]}',
    );
    expect(canonicalJson([{ z: 1, a: [3, 1, 2] }, 'b', null])).toBe(
      '[{"a":[3,1,2],"z":1},"b",null]',
    );
  });

  it('is independent of key insertion order', () => {
    expect(canonicalJson({ a: 1, b: 2, c: 3 })).toBe(canonicalJson({ c: 3, b: 2, a: 1 }));
  });

  it('sorts keys by UTF-16 code unit order', () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3, é: 4, '10': 5, '9': 6 })).toBe(
      '{"10":5,"9":6,"B":2,"a":3,"b":1,"é":4}',
    );
  });

  it('writes primitives as JSON.stringify does and has no whitespace outside strings', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(0)).toBe('0');
    expect(canonicalJson(-1.5)).toBe('-1.5');
    expect(canonicalJson('he said "hi"\n')).toBe(JSON.stringify('he said "hi"\n'));
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson([])).toBe('[]');
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
    ['NaN nested', [{ a: Number.NaN }]],
  ])('throws on %s', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });
});
