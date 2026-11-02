// The client side of the `answer.text` splice (specs/d1-demo-slice.md §4.4, revision 4h): the common prefix and
// suffix of two consecutive textarea values, both boundaries moved out of any surrogate pair, so `i` and every
// rebuilt text are storable. The edge applies the splice with `applySplice` (workers/edge/src/session-evidence.ts);
// `applySplice` here is the same rule, and the property test replays every derived splice from empty.
import { isStorableText as contractIsStorable } from '@trace/shared/contracts/candidate';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applySplice, spliceOf, type Splice } from './splice';

/** fast-check runs a fixed seed, so a failure replays from its seed and path. */
const SEED = 20_261_019;

// Two emoji that share a high surrogate (U+1F600, U+1F601), so a UTF-16 prefix or suffix can end inside a pair.
const ALPHABET = ['a', 'b', 'c', ' ', '\n', 'é', '😀', '😁', '😂', 'Z'];
const textArb = fc
  .array(fc.constantFrom(...ALPHABET), { maxLength: 12 })
  .map((chars) => chars.join(''));

describe('spliceOf', () => {
  it('describes an insert, a delete and a replace', () => {
    expect(spliceOf('', 'abc')).toEqual({ p: 0, d: 0, i: 'abc' });
    expect(spliceOf('abc', 'abXc')).toEqual({ p: 2, d: 0, i: 'X' });
    expect(spliceOf('abc', 'ac')).toEqual({ p: 1, d: 1, i: '' });
    expect(spliceOf('abc', 'aXc')).toEqual({ p: 1, d: 1, i: 'X' });
    expect(spliceOf('abc', '')).toEqual({ p: 0, d: 3, i: '' });
    expect(spliceOf('abc', 'abc')).toEqual({ p: 3, d: 0, i: '' });
  });

  it('moves a prefix boundary out of a surrogate pair (emoji sharing a high surrogate)', () => {
    // '😀' = D83D DE00, '😁' = D83D DE01: the raw common prefix is one unit, inside the pair.
    const s = spliceOf('😀', '😁');
    expect(s).toEqual({ p: 0, d: 2, i: '😁' });
    expect(contractIsStorable(s.i)).toBe(true);
  });

  it('moves a suffix boundary out of a surrogate pair', () => {
    // 'x😀' -> 'y😀' shares the pair as suffix; 'a\uDE00'-style tails must never be split.
    expect(spliceOf('x😀', 'y😀')).toEqual({ p: 0, d: 1, i: 'y' });
    const s = spliceOf('😀a', '😁a');
    expect(s).toEqual({ p: 0, d: 2, i: '😁' });
  });

  it('rebuilds the next value from the previous one', () => {
    for (const [prev, next] of [
      ['hello world', 'hello brave world'],
      ['😀😁', '😁😁'],
      ['😁😀', '😁😁'],
      ['a😀b', 'a😁b'],
    ] as const) {
      expect(applySplice(prev, spliceOf(prev, next))).toBe(next);
    }
  });
});

describe('applySplice', () => {
  it('keeps p units, deletes d, inserts i', () => {
    expect(applySplice('abcdef', { p: 2, d: 2, i: 'XY' })).toBe('abXYef');
  });

  it('refuses a range outside the text', () => {
    expect(applySplice('abc', { p: 4, d: 0, i: '' })).toBeNull();
    expect(applySplice('abc', { p: 2, d: 2, i: '' })).toBeNull();
  });
});

describe('splice property (rev 4h)', () => {
  it('replaying the splices from empty reproduces every textarea value; every i and text is storable', () => {
    fc.assert(
      fc.property(fc.array(textArb, { minLength: 1, maxLength: 20 }), (values) => {
        let server = '';
        let prev = '';
        for (const next of values) {
          const s: Splice = spliceOf(prev, next);
          expect(s.p).toBeGreaterThanOrEqual(0);
          expect(s.d).toBeGreaterThanOrEqual(0);
          expect(contractIsStorable(s.i)).toBe(true);
          const rebuilt = applySplice(server, s);
          expect(rebuilt).toBe(next);
          expect(contractIsStorable(rebuilt ?? '\u0000')).toBe(true);
          server = rebuilt ?? '';
          prev = next;
        }
        return server === values.at(-1);
      }),
      { seed: SEED, numRuns: 500 },
    );
  });

  it('gives the minimal splice when no surrogate pair is involved', () => {
    const ascii = fc
      .array(fc.constantFrom('a', 'b', ' '), { maxLength: 10 })
      .map((c) => c.join(''));
    fc.assert(
      fc.property(ascii, ascii, (prev, next) => {
        const s = spliceOf(prev, next);
        // Minimal: the inserted run is no longer than the length difference plus what was deleted.
        return s.i.length - s.d === next.length - prev.length && applySplice(prev, s) === next;
      }),
      { seed: SEED, numRuns: 500 },
    );
  });
});
