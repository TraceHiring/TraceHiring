// The local copy of `isStorableText` (the candidate bundle may not import the zod contracts at runtime, spec D3)
// must agree with the contract's on every string, including NUL and lone or paired surrogates.
import { isStorableText as contractIsStorable } from '@trace/shared/contracts/candidate';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isStorableText, utf16Length } from './text';

const SAMPLES = [
  '',
  'plain',
  'line\nbreak',
  'é',
  '😀',
  '😀😁',
  '\u0000',
  'a\u0000b',
  '\uD83D',
  '\uDE00',
  'a\uD83Db',
  '\uDE00\uD83D',
  '😀\uD83D',
  '￿',
  '\u0001\u001F',
];

describe('isStorableText', () => {
  it.each(SAMPLES.map((s) => [JSON.stringify(s), s] as const))(
    'agrees with the contract on %s',
    (_name, s) => {
      expect(isStorableText(s)).toBe(contractIsStorable(s));
    },
  );

  it('refuses NUL and lone surrogates, and accepts pairs', () => {
    expect(isStorableText('ok 😀')).toBe(true);
    expect(isStorableText('\u0000')).toBe(false);
    expect(isStorableText('\uD83D')).toBe(false);
    expect(isStorableText('x\uDE00')).toBe(false);
  });

  it('agrees with the contract on arbitrary UTF-16 strings (fast-check)', () => {
    const unit = fc.oneof(
      fc.constantFrom(0x00, 0x41, 0x0a, 0xd83d, 0xde00, 0xde01, 0xdbff, 0xdc00, 0xffff),
      fc.integer({ min: 0, max: 0xffff }),
    );
    fc.assert(
      fc.property(fc.array(unit, { maxLength: 12 }), (units) => {
        const s = String.fromCharCode(...units);
        return isStorableText(s) === contractIsStorable(s);
      }),
      { seed: 20_261_019, numRuns: 2_000 },
    );
  });
});

describe('utf16Length', () => {
  it('counts UTF-16 code units, as the edge and maxChars do', () => {
    expect(utf16Length('')).toBe(0);
    expect(utf16Length('abc')).toBe(3);
    expect(utf16Length('😀')).toBe(2);
    expect(utf16Length('é')).toBe(1);
  });
});
