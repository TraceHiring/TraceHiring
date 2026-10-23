// sfc32 from the first 128 bits of a seed (specs/m1-test-authoring.md §6.3, R5-52 b): deterministic, seed-only.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sfc32, uniformBelow } from './prng.js';

const seed = (fill: (i: number) => number, length = 32) =>
  Uint8Array.from({ length }, (_, i) => fill(i));

describe('sfc32', () => {
  it('uses only the first 16 bytes of the seed', () => {
    const a = sfc32(seed((i) => i));
    const b = sfc32(seed((i) => (i < 16 ? i : 255 - i)));
    for (let k = 0; k < 20; k += 1) expect(a.next()).toBe(b.next());
  });

  it('gives the same stream for the same seed and 32-bit unsigned outputs', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 16, maxLength: 32 }), (bytes) => {
        const a = sfc32(bytes);
        const b = sfc32(Uint8Array.from(bytes));
        for (let k = 0; k < 8; k += 1) {
          const x = a.next();
          expect(b.next()).toBe(x);
          expect(Number.isInteger(x) && x >= 0 && x < 2 ** 32).toBe(true);
        }
      }),
    );
  });

  it('differs when any of the first 16 bytes differs', () => {
    const base = seed(() => 0);
    const first = sfc32(base).next();
    for (let i = 0; i < 16; i += 1) {
      const changed = Uint8Array.from(base);
      changed[i] = 1;
      expect(sfc32(changed).next()).not.toBe(first);
    }
  });

  // Regression pin: stored variants are regenerated from their seeds, so the stream must never change silently.
  it('pins the stream for seed bytes 0..15 (big-endian words, 12 outputs discarded)', () => {
    const rng = sfc32(seed((i) => i, 16));
    expect([rng.next(), rng.next(), rng.next()]).toEqual([858807458, 1403912697, 1845977855]);
  });

  it('refuses a seed shorter than 128 bits', () => {
    expect(() => sfc32(new Uint8Array(15))).toThrow(RangeError);
  });
});

describe('uniformBelow', () => {
  it('stays in range for small and for wide ranges (above 2^32)', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 16, maxLength: 16 }),
        fc.bigInt({ min: 1n, max: 2n ** 54n }),
        (bytes, n) => {
          const rng = sfc32(bytes);
          for (let k = 0; k < 4; k += 1) {
            const x = uniformBelow(rng, n);
            expect(x >= 0n && x < n).toBe(true);
          }
        },
      ),
    );
  });

  it('refuses an empty range', () => {
    expect(() => uniformBelow(sfc32(seed(() => 1)), 0n)).toThrow(RangeError);
  });
});
