// The delivery stream is the same sfc32 as @trace/item-variants (review round 1): pinned against the same reference
// outputs as packages/item-variants/src/prng.test.ts, so the two copies cannot drift apart.
import { describe, expect, it } from 'vitest';
import { sfc32, uniform01, uniformInt } from './prng.js';

const seed = (length = 16) => Uint8Array.from({ length }, (_, i) => i);

describe('delivery sfc32', () => {
  it('matches the item-variants reference outputs for seed bytes 0..15', () => {
    const rng = sfc32(seed());
    expect([rng.next(), rng.next(), rng.next()]).toEqual([858807458, 1403912697, 1845977855]);
  });

  it('uses only the first 16 bytes and refuses a shorter seed', () => {
    const long = Uint8Array.from({ length: 32 }, (_, i) => (i < 16 ? i : 200));
    const a = sfc32(long);
    const b = sfc32(seed());
    for (let k = 0; k < 10; k += 1) expect(a.next()).toBe(b.next());
    expect(() => sfc32(new Uint8Array(15))).toThrow();
  });

  it('uniformInt stays in range and uniform01 is in [0, 1)', () => {
    const rng = sfc32(seed());
    for (let k = 0; k < 1000; k += 1) {
      const n = (k % 7) + 1;
      const x = uniformInt(rng, n);
      expect(Number.isInteger(x) && x >= 0 && x < n).toBe(true);
      const u = uniform01(rng);
      expect(u >= 0 && u < 1).toBe(true);
    }
  });
});
