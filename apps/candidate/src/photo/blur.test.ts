// AT-D9 (specs/d1-demo-slice.md §4.5, rule 8): the start photo is blurred outside the face oval on the device, by one
// pure pixel-array function. Node environment, plain arrays: no canvas, no browser.
//
// "Mean absolute neighbour difference" of a pixel: the mean, over its 4-neighbours that lie in the same region
// (outside the oval) and over the R, G and B channels, of |pixel - neighbour|. The source's value is the same mean over
// the whole source frame. A pixel next to the oval edge is compared with its outside neighbours only, because the
// inside must stay exactly the source (the edge is a hard step by design).
import { describe, expect, it } from 'vitest';
import {
  BLUR_STRENGTH,
  blurOutsideOval,
  insideOval,
  ovalOf,
  type BlurStrength,
  type Frame,
} from './blur';

const W = 640;
const H = 480;

/** A grey checkerboard of `cell`-pixel squares (0 / 255), fully opaque. */
const checkerboard = (width: number, height: number, cell: number): Frame => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const v = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? 0 : 255;
      const o = (y * width + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  return { data, width, height };
};

const at = (f: Frame, x: number, y: number, c: number): number =>
  f.data[(y * f.width + x) * 4 + c] ?? 0;

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Mean |difference| between (x, y) and its 4-neighbours that `keep` accepts, over RGB; null if none. */
const neighbourDiff = (
  f: Frame,
  x: number,
  y: number,
  keep: (nx: number, ny: number) => boolean,
): number | null => {
  let sum = 0;
  let n = 0;
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= f.width || ny >= f.height || !keep(nx, ny)) continue;
    for (let c = 0; c < 3; c += 1) {
      sum += Math.abs(at(f, x, y, c) - at(f, nx, ny, c));
      n += 1;
    }
  }
  return n === 0 ? null : sum / n;
};

/** The source's mean neighbour difference over the whole frame. */
const frameDiff = (f: Frame): number => {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < f.height; y += 1)
    for (let x = 0; x < f.width; x += 1) {
      const d = neighbourDiff(f, x, y, () => true);
      if (d !== null) {
        sum += d;
        n += 1;
      }
    }
  return sum / n;
};

describe('ovalOf (AT-D9 geometry)', () => {
  it('is centred at 50%/50% with radii 30% of the width and 42% of the height', () => {
    expect(ovalOf(W, H)).toEqual({ cx: 320, cy: 240, rx: 192, ry: 201.6 });
    expect(ovalOf(200, 100)).toEqual({ cx: 100, cy: 50, rx: 60, ry: 42 });
  });

  it('puts the centre inside and the corners and the far edges outside', () => {
    const oval = ovalOf(W, H);
    expect(insideOval(oval, 320, 240)).toBe(true);
    expect(insideOval(oval, 0, 0)).toBe(false);
    expect(insideOval(oval, W - 1, H - 1)).toBe(false);
    // Just inside and just outside the horizontal radius (pixel centres at x + 0.5).
    expect(insideOval(oval, 320 + 191, 240)).toBe(true);
    expect(insideOval(oval, 320 + 193, 240)).toBe(false);
    expect(insideOval(oval, 320, 240 - 201)).toBe(true);
    expect(insideOval(oval, 320, 240 - 203)).toBe(false);
  });
});

describe('blurOutsideOval (AT-D9)', () => {
  for (const cell of [1, 2, 3]) {
    it(`blurs every pixel outside the oval of a ${cell}px checkerboard and keeps the inside exact`, () => {
      const source = checkerboard(W, H, cell);
      const oval = ovalOf(W, H);
      const out = blurOutsideOval(source, oval);

      // The output has the size of the input.
      expect(out.width).toBe(W);
      expect(out.height).toBe(H);
      expect(out.data.length).toBe(W * H * 4);
      expect(out.data).not.toBe(source.data);

      const limit = 0.1 * frameDiff(source);
      expect(limit).toBeGreaterThan(5);
      const outside = (x: number, y: number) => !insideOval(oval, x, y);
      let inside = 0;
      let blurred = 0;
      let worst = 0;
      // Counted, then asserted once: one expect per outside pixel (~180k) made this test slower than vitest's 5 s
      // limit on the GitHub runners (CI runs 39760204704 and 39761464844, 2026-10-22). Every pixel is still checked.
      let notOpaque = 0;
      for (let y = 0; y < H; y += 1)
        for (let x = 0; x < W; x += 1) {
          const o = (y * W + x) * 4;
          if (insideOval(oval, x, y)) {
            inside += 1;
            for (let c = 0; c < 4; c += 1) {
              if (out.data[o + c] !== source.data[o + c]) {
                throw new Error(`inside pixel ${x},${y} channel ${c} changed`);
              }
            }
            continue;
          }
          blurred += 1;
          const d = neighbourDiff(out, x, y, outside);
          if (d !== null) worst = Math.max(worst, d);
          if (out.data[o + 3] !== 255) notOpaque += 1;
        }
      expect(notOpaque).toBe(0);
      expect(worst).toBeLessThan(limit);
      // Both regions are large: the oval is 0.3 * 0.42 * pi of the frame, about 40%.
      expect(inside / (W * H)).toBeGreaterThan(0.38);
      expect(inside / (W * H)).toBeLessThan(0.42);
      expect(blurred).toBe(W * H - inside);
    });
  }

  // SR-10: blur strength is a privacy control. On coarse checkerboards (16 and 32 px cells, the scale of facial
  // features in a 640 px frame) the neighbour metric above is weak, so this one measures what is left of the pattern:
  // the standard deviation of the output outside the oval over the source's (127.5). The shipped blur leaves about
  // 1.5% at 16 px and 10.5% at 32 px (measured); the bounds are 5% and 15%. Each weaker blur below fails one of them
  // (measured: 4/1/1 leaves 52% and 77%, 8/1/1 11% and 55%, 8/2/1 25% at 32 px).
  const residual = (cell: number, strength?: BlurStrength): number => {
    const source = checkerboard(W, H, cell);
    const oval = ovalOf(W, H);
    const out = blurOutsideOval(source, oval, strength);
    let n = 0;
    let sum = 0;
    let sq = 0;
    for (let y = 0; y < H; y += 1)
      for (let x = 0; x < W; x += 1) {
        if (insideOval(oval, x, y)) continue;
        const v = at(out, x, y, 0);
        n += 1;
        sum += v;
        sq += v * v;
      }
    const mean = sum / n;
    return Math.sqrt(sq / n - mean * mean) / 127.5;
  };

  it('SR-10: removes most of a 16 px and a 32 px checkerboard outside the oval', () => {
    expect(residual(16)).toBeLessThan(0.05);
    expect(residual(32)).toBeLessThan(0.15);
  });

  it('SR-10: the strength metric fails every weaker blur', () => {
    const passes = (s?: BlurStrength) => residual(16, s) < 0.05 && residual(32, s) < 0.15;
    expect(passes()).toBe(true);
    for (const weak of [
      { factor: 4, radius: 1, passes: 1 },
      { factor: 8, radius: 1, passes: 1 },
      { factor: 8, radius: 2, passes: 1 },
    ])
      expect(passes(weak), JSON.stringify(weak)).toBe(false);
    expect(BLUR_STRENGTH).toEqual({ factor: 8, radius: 2, passes: 2 });
  });

  it('does not change its input', () => {
    const source = checkerboard(64, 48, 1);
    const copy = new Uint8ClampedArray(source.data);
    blurOutsideOval(source, ovalOf(64, 48));
    expect(source.data).toEqual(copy);
  });

  it('works on sizes that are not a multiple of the down-scale factor', () => {
    const source = checkerboard(161, 163, 1);
    const out = blurOutsideOval(source, ovalOf(161, 163));
    expect(out.width).toBe(161);
    expect(out.height).toBe(163);
    expect(out.data.length).toBe(161 * 163 * 4);
  });

  it('is deterministic', () => {
    const source = checkerboard(96, 72, 2);
    const a = blurOutsideOval(source, ovalOf(96, 72));
    const b = blurOutsideOval(source, ovalOf(96, 72));
    expect(a.data).toEqual(b.data);
  });

  it('throws on a wrong-size input', () => {
    const good = checkerboard(64, 48, 1);
    const oval = ovalOf(64, 48);
    expect(() =>
      blurOutsideOval({ data: good.data.subarray(4), width: 64, height: 48 }, oval),
    ).toThrow();
    expect(() => blurOutsideOval({ data: good.data, width: 65, height: 48 }, oval)).toThrow();
    expect(() =>
      blurOutsideOval({ data: new Uint8ClampedArray(0), width: 0, height: 0 }, oval),
    ).toThrow();
    expect(() => blurOutsideOval({ data: good.data, width: 64.5, height: 48 }, oval)).toThrow();
  });
});
