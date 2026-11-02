// The start photo leaves the device as APP0-only JPEG (specs/d1-demo-slice.md §4.5, revision 4i; rule 8). Chromium's
// canvas JPEG carries an APP2 ICC profile, which the edge refuses (workers/edge/src/jpeg.ts: no APP1-APP15 or COM
// before the first scan, body ends FF D9). `stripJpegMetadata` drops those segments and keeps everything else byte
// for byte. The fixture below is shaped like the Chromium probe: SOI, APP0 JFIF, APP2 (472), DQT x2, SOF0, DHT x4,
// SOS, scan data, EOI.
import { describe, expect, it } from 'vitest';
import { stripJpegMetadata } from './jpeg';

/** One marker segment: FF, marker, a 2-byte length (payload + 2), the payload. */
const segment = (marker: number, payload: number[]): number[] => {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
};
const fill = (n: number, v: number) => Array.from({ length: n }, (_, k) => (v + k) & 0xff);

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const APP0 = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]); // len 16
const APP1_EXIF = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...fill(40, 3)]);
const APP2_ICC = segment(0xe2, fill(470, 7)); // len 472
const COM = segment(0xfe, fill(12, 0x41));
const DQT0 = segment(0xdb, [0, ...fill(64, 1)]);
const DQT1 = segment(0xdb, [1, ...fill(64, 2)]);
/** SOF0 for 320 x 240: precision 8, height, width, 3 components. */
const SOF0 = segment(0xc0, [8, 0x00, 0xf0, 0x01, 0x40, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
const DHT = (k: number) => segment(0xc4, [k, ...fill(28, k)]);
const SOS = segment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]);
/** Entropy-coded data, with stuffed FF 00 and a restart marker, as a real scan has. */
const SCAN = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78, 0xff, 0x00];

const jpeg = (...parts: number[][]) => new Uint8Array(parts.flat());

const probe = () =>
  jpeg(SOI, APP0, APP2_ICC, DQT0, DQT1, SOF0, DHT(0), DHT(1), DHT(0x10), DHT(0x11), SOS, SCAN, EOI);
const clean = () =>
  jpeg(SOI, APP0, DQT0, DQT1, SOF0, DHT(0), DHT(1), DHT(0x10), DHT(0x11), SOS, SCAN, EOI);

/** The frame size from SOF0, the way the edge reads it. */
const sofSize = (bytes: Uint8Array) => {
  for (let i = 2; i + 8 < bytes.length; i += 1)
    if (bytes[i] === 0xff && bytes[i + 1] === 0xc0)
      return {
        height: ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0),
        width: ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0),
      };
  return null;
};

describe('stripJpegMetadata', () => {
  it('drops only the APP2 ICC segment of a Chromium-shaped JPEG', () => {
    expect(stripJpegMetadata(probe())).toEqual(clean());
  });

  it('drops APP1 (Exif) and COM too, and keeps APP0', () => {
    const out = stripJpegMetadata(
      jpeg(SOI, APP0, APP1_EXIF, COM, DQT0, SOF0, DHT(0), SOS, SCAN, EOI),
    );
    expect(out).toEqual(jpeg(SOI, APP0, DQT0, SOF0, DHT(0), SOS, SCAN, EOI));
  });

  it('keeps the SOF dimensions and ends with FF D9', () => {
    const out = stripJpegMetadata(probe());
    expect(sofSize(out)).toEqual({ width: 320, height: 240 });
    expect(sofSize(out)).toEqual(sofSize(probe()));
    expect([...out.slice(-2)]).toEqual(EOI);
    expect([...out.slice(0, 2)]).toEqual(SOI);
  });

  it('returns an already clean JPEG unchanged', () => {
    expect(stripJpegMetadata(clean())).toEqual(clean());
  });

  it('keeps the scan byte for byte, including stuffed bytes and restart markers', () => {
    const out = stripJpegMetadata(probe());
    const tail = out.slice(out.length - SCAN.length - EOI.length);
    expect([...tail]).toEqual([...SCAN, ...EOI]);
  });

  it('refuses malformed input', () => {
    const bad: [string, Uint8Array][] = [
      ['empty', new Uint8Array(0)],
      ['no SOI', jpeg(APP0, SOF0, SOS, SCAN, EOI)],
      ['a length past the end', jpeg(SOI, APP0, [0xff, 0xdb, 0x10, 0x00, 1, 2, 3])],
      ['a length under 2', jpeg(SOI, [0xff, 0xdb, 0x00, 0x01], SOS, SCAN, EOI)],
      ['no SOS', jpeg(SOI, APP0, DQT0, SOF0, EOI)],
      ['not ending FF D9', jpeg(SOI, APP0, SOF0, SOS, SCAN)],
      ['bytes after EOI', jpeg(SOI, APP0, SOF0, SOS, SCAN, EOI, [0x00])],
      ['a non-marker byte between segments', jpeg(SOI, APP0, [0x00], SOF0, SOS, SCAN, EOI)],
    ];
    for (const [name, input] of bad) expect(() => stripJpegMetadata(input), name).toThrow();
  });

  it('does not change its input', () => {
    const input = probe();
    const copy = new Uint8Array(input);
    stripJpegMetadata(input);
    expect(input).toEqual(copy);
  });
});
