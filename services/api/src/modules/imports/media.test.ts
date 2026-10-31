// Image sniffing for import uploads (spec m1 §6.9, E11): the type comes from the magic bytes and the size from the
// header; anything else is not an image. Synthetic header bytes only.
import { describe, expect, it } from 'vitest';
import { mediaKeyOf, sniffImage } from './media.js';
import { jpegBytes, pngBytes, webpBytes } from './imports.test-helpers.js';

describe('sniffImage', () => {
  it('reads PNG, JPEG and WebP VP8X sizes', () => {
    expect(sniffImage(pngBytes(640, 480))).toEqual({ ext: 'png', width: 640, height: 480 });
    expect(sniffImage(jpegBytes(800, 600))).toEqual({ ext: 'jpg', width: 800, height: 600 });
    expect(sniffImage(webpBytes(4096, 10))).toEqual({ ext: 'webp', width: 4096, height: 10 });
  });

  it('reads WebP VP8L and VP8 sizes', () => {
    // VP8L: 14-bit width-1 and height-1 packed after the 0x2f signature byte.
    const w = 300 - 1;
    const h = 200 - 1;
    const vp8l = new Uint8Array([
      82,
      73,
      70,
      70,
      0,
      0,
      0,
      0,
      87,
      69,
      66,
      80,
      86,
      80,
      56,
      76,
      0,
      0,
      0,
      0,
      0x2f,
      w & 255,
      ((w >> 8) & 0x3f) | ((h & 3) << 6),
      (h >> 2) & 255,
      (h >> 10) & 0x0f,
    ]);
    expect(sniffImage(vp8l)).toEqual({ ext: 'webp', width: 300, height: 200 });
    const vp8 = new Uint8Array(30);
    vp8.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]);
    vp8.set([120, 0, 90, 0], 26);
    expect(sniffImage(vp8)).toEqual({ ext: 'webp', width: 120, height: 90 });
  });

  it('refuses other bytes and reports a JPEG without a frame header as sizeless', () => {
    expect(sniffImage(new Uint8Array([71, 73, 70, 56, 57, 97]))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toEqual({
      ext: 'jpg',
      width: null,
      height: null,
    });
  });

  it('names the content-addressed key', () => {
    expect(mediaKeyOf('a1000000-0000-4000-8000-000000000001', 'ab'.repeat(32), 'png')).toBe(
      `item-media/a1000000-0000-4000-8000-000000000001/${'ab'.repeat(32)}.png`,
    );
  });
});
