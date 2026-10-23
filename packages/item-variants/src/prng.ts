// sfc32 (Chris Doty-Humphrey's Small Fast Counting generator, 32-bit) seeded from the first 128 bits of a seed
// (specs/m1-test-authoring.md §6.3, R5-52 b). The four state words are the seed's bytes 0-15 read as big-endian
// uint32; the first 12 outputs are discarded so nearby seeds diverge. Pure: the seed is the only input.

export interface Prng {
  /** The next output, an integer in [0, 2^32). */
  next(): number;
}

const WARM_UP = 12;

export function sfc32(seed: Uint8Array): Prng {
  if (!(seed instanceof Uint8Array) || seed.length < 16) {
    throw new RangeError('seed: at least 16 bytes');
  }
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
  for (let i = 0; i < WARM_UP; i += 1) next();
  return { next };
}

const TWO_32 = 2n ** 32n;
const TWO_64 = 2n ** 64n;

/** A uniform integer in [0, n), by rejection (no modulo bias); n may exceed 2^32 (two outputs per try). */
export function uniformBelow(rng: Prng, n: bigint): bigint {
  if (n < 1n) throw new RangeError('uniformBelow: empty range');
  if (n <= TWO_32) {
    const limit = (TWO_32 / n) * n;
    for (;;) {
      const r = BigInt(rng.next());
      if (r < limit) return r % n;
    }
  }
  const limit = (TWO_64 / n) * n;
  for (;;) {
    const r = (BigInt(rng.next()) << 32n) | BigInt(rng.next());
    if (r < limit) return r % n;
  }
}
