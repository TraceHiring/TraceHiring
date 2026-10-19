// The start-photo blur (specs/d1-demo-slice.md §4.5, rule 8): everything outside the face oval is blurred on the
// device before any frame is shown or exported. One pure function on ImageData-shaped pixel arrays, so every browser
// and the AT-D9 test run the same code path (no `ctx.filter`): a block-average down-scale, a separable box blur on the
// small image, and a bilinear up-scale for the pixels outside the oval. Pixels inside the oval are copied unchanged.

/** An ImageData-shaped frame: RGBA bytes, row by row. */
export interface Frame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** An axis-aligned ellipse in pixel coordinates. */
export interface Oval {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** The face guide: centre 50%/50%, radii 30% of the width and 42% of the height (§4.5). */
export const ovalOf = (width: number, height: number): Oval => ({
  cx: width * 0.5,
  cy: height * 0.5,
  rx: width * 0.3,
  ry: height * 0.42,
});

/** Whether the centre of pixel (x, y) lies inside the oval (the boundary counts as inside). */
export const insideOval = (oval: Oval, x: number, y: number): boolean => {
  const dx = (x + 0.5 - oval.cx) / oval.rx;
  const dy = (y + 0.5 - oval.cy) / oval.ry;
  return dx * dx + dy * dy <= 1;
};

/** Down-scale factor and blur radius (in small-image pixels): about a 40 px blur on a 640 px frame. */
const FACTOR = 8;
const RADIUS = 2;
const PASSES = 2;

const isSize = (n: number): boolean => Number.isInteger(n) && n > 0 && n <= 8192;

/** One separable box-blur pass over a float RGB image (edges clamped). */
const boxBlur = (src: Float32Array, w: number, h: number): Float32Array<ArrayBuffer> => {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = 2 * RADIUS + 1;
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1)
      for (let c = 0; c < 3; c += 1) {
        let sum = 0;
        for (let k = -RADIUS; k <= RADIUS; k += 1) {
          const sx = Math.min(w - 1, Math.max(0, x + k));
          sum += src[(y * w + sx) * 3 + c] ?? 0;
        }
        tmp[(y * w + x) * 3 + c] = sum / span;
      }
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1)
      for (let c = 0; c < 3; c += 1) {
        let sum = 0;
        for (let k = -RADIUS; k <= RADIUS; k += 1) {
          const sy = Math.min(h - 1, Math.max(0, y + k));
          sum += tmp[(sy * w + x) * 3 + c] ?? 0;
        }
        out[(y * w + x) * 3 + c] = sum / span;
      }
  return out;
};

/**
 * Returns a new frame of the same size: inside the oval the source bytes exactly, outside a heavy blur (opaque).
 * Throws when `data` does not hold `width * height` RGBA pixels. The input is never changed.
 */
export const blurOutsideOval = (frame: Frame, oval: Oval): Frame => {
  const { data, width, height } = frame;
  if (!isSize(width) || !isSize(height) || data.length !== width * height * 4) {
    throw new RangeError('frame size does not match its pixel data');
  }
  // Block averages (a partial block at the right or bottom edge averages what it has).
  const sw = Math.ceil(width / FACTOR);
  const sh = Math.ceil(height / FACTOR);
  let small: Float32Array<ArrayBuffer> = new Float32Array(sw * sh * 3);
  const counts = new Float32Array(sw * sh);
  for (let y = 0; y < height; y += 1) {
    const by = Math.floor(y / FACTOR);
    for (let x = 0; x < width; x += 1) {
      const b = by * sw + Math.floor(x / FACTOR);
      const o = (y * width + x) * 4;
      small[b * 3] = (small[b * 3] ?? 0) + (data[o] ?? 0);
      small[b * 3 + 1] = (small[b * 3 + 1] ?? 0) + (data[o + 1] ?? 0);
      small[b * 3 + 2] = (small[b * 3 + 2] ?? 0) + (data[o + 2] ?? 0);
      counts[b] = (counts[b] ?? 0) + 1;
    }
  }
  for (let b = 0; b < sw * sh; b += 1)
    for (let c = 0; c < 3; c += 1) small[b * 3 + c] = (small[b * 3 + c] ?? 0) / (counts[b] ?? 1);
  for (let pass = 0; pass < PASSES; pass += 1) small = boxBlur(small, sw, sh);

  const out = new Uint8ClampedArray(data);
  const sample = (sx: number, sy: number, c: number): number => small[(sy * sw + sx) * 3 + c] ?? 0;
  for (let y = 0; y < height; y += 1) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / FACTOR - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x += 1) {
      if (insideOval(oval, x, y)) continue;
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / FACTOR - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const top = sample(x0, y0, c) * (1 - tx) + sample(x1, y0, c) * tx;
        const bottom = sample(x0, y1, c) * (1 - tx) + sample(x1, y1, c) * tx;
        out[o + c] = Math.round(top * (1 - ty) + bottom * ty);
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width, height };
};
