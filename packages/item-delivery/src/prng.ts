// The delivery stream (specs/m1-test-authoring.md §6.5, R5-52 b): sfc32 seeded from the seed's bytes 0-15
// (big-endian words, 12 outputs discarded), the same generator as @trace/item-variants/src/prng.ts. The two copies
// are pinned to the same reference outputs (prng.test.ts in each package), since neither package may import the other.
import { DrawError } from './errors.js';

export interface Prng {
  /** The next output, an integer in [0, 2^32). */
  next(): number;
}

export function sfc32(seed: Uint8Array): Prng {
  if (!(seed instanceof Uint8Array) || seed.length < 16) throw new DrawError('bad_seed');
  const word = (i: number) =>
    ((seed[i]! << 24) | (seed[i + 1]! << 16) | (seed[i + 2]! << 8) | seed[i + 3]!) >>> 0;
  let a = word(0);
  let b = word(4);
  let c = word(8);
  let d = word(12);
  const next = (): number => {
    // The reference C: tmp = a + b + counter++; a = b ^ (b >> 9); b = c + (c << 3); c = rotl(c, 21) + tmp.
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (((c << 21) | (c >>> 11)) + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i += 1) next();
  return { next };
}

/** A uniform integer in [0, n) for 1 <= n <= 2^32, by rejection (no modulo bias). */
export function uniformInt(rng: Prng, n: number): number {
  const limit = Math.floor(2 ** 32 / n) * n;
  for (;;) {
    const r = rng.next();
    if (r < limit) return r % n;
  }
}

/** A uniform number in [0, 1) with 53 random bits (two outputs). */
export const uniform01 = (rng: Prng): number =>
  ((rng.next() >>> 5) * 67108864 + (rng.next() >>> 6)) / 9007199254740992;
