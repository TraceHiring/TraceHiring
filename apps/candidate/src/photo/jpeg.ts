// The start photo leaves the device as an APP0-only JPEG (specs/d1-demo-slice.md §4.5, revision 4i; rule 8).
// Chromium's `canvas.toBlob('image/jpeg')` adds an APP2 ICC profile, and the edge refuses any APP1-APP15 or COM
// segment before the first scan. This walks the marker segments from SOI to the first SOS, drops every APP1-APP15
// (FF E1 to FF EF) and COM (FF FE) segment, and keeps APP0, every other segment and the entropy-coded data byte for
// byte. A malformed stream throws: no SOI, a segment length under 2 or running past the end, no SOS, or a body that
// does not end FF D9. Pixels are never decoded. Imported only by PhotoStep.tsx (the photo chunk).

const isDropped = (marker: number): boolean =>
  (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
const isStandalone = (marker: number): boolean =>
  marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

const fail = (why: string): never => {
  throw new RangeError(`not a usable JPEG: ${why}`);
};

export const stripJpegMetadata = (bytes: Uint8Array): Uint8Array => {
  const n = bytes.length;
  if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail('no SOI');
  if (bytes[n - 2] !== 0xff || bytes[n - 1] !== 0xd9) return fail('does not end with EOI');
  const keep: [number, number][] = [[0, 2]];
  let i = 2;
  for (;;) {
    if (i + 1 >= n || bytes[i] !== 0xff) return fail('expected a marker');
    // Fill bytes (extra FF) before a marker are allowed; they are not copied.
    let m = i + 1;
    while (m < n && bytes[m] === 0xff) m += 1;
    if (m >= n) return fail('truncated marker');
    const marker = bytes[m] ?? 0;
    const start = m - 1;
    if (marker === 0xd9 || marker === 0xd8) return fail('no SOS');
    if (isStandalone(marker)) {
      keep.push([start, m + 1]);
      i = m + 1;
      continue;
    }
    if (m + 2 >= n) return fail('truncated length');
    const length = ((bytes[m + 1] ?? 0) << 8) | (bytes[m + 2] ?? 0);
    if (length < 2) return fail('segment length under 2');
    const end = m + 1 + length;
    if (end > n) return fail('segment runs past the end');
    if (marker === 0xda) {
      // SOS: its header, the scan and everything after it to EOI, byte for byte.
      keep.push([start, n]);
      break;
    }
    if (!isDropped(marker)) keep.push([start, end]);
    i = end;
  }
  // The data after SOS must end at the first EOI: no trailing bytes after it.
  const sos = keep.at(-1)?.[0] ?? 0;
  for (let k = sos + 2; k + 1 < n - 2; k += 1) {
    if (bytes[k] === 0xff && bytes[k + 1] === 0xd9) return fail('bytes after EOI');
  }
  const out = new Uint8Array(keep.reduce((sum, [a, b]) => sum + (b - a), 0));
  let o = 0;
  for (const [a, b] of keep) {
    out.set(bytes.subarray(a, b), o);
    o += b - a;
  }
  return out;
};
