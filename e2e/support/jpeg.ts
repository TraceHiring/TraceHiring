// The start photo's header clean-up as the candidate app does it (spec rev 4i, lead 2026-10-19): Chromium's canvas
// `toBlob('image/jpeg', 0.85)` writes APP0 (JFIF) and then APP2 (an ICC profile), and the edge refuses every
// APP1-APP15 and COM segment (workers/edge/src/jpeg.ts). The client therefore drops those segments before hashing
// and uploading. Marker headers only: the entropy-coded scan from the first SOS on is copied byte for byte.

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const COM = 0xfe;

/** APP1-APP15 and COM: metadata a blurred start photo never needs. */
export const isMetadataMarker = (marker: number): boolean =>
  (marker > APP0 && marker <= 0xef) || marker === COM;

interface Segment {
  marker: number;
  start: number;
  end: number;
}

/** The marker segments from SOI to the first SOS (exclusive), and where the scan starts. Throws if malformed. */
export const jpegHeaderSegments = (
  bytes: Uint8Array,
): { segments: Segment[]; scanStart: number } => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) throw new Error('jpeg: no SOI');
  const segments: Segment[] = [];
  let i = 2;
  for (;;) {
    if (i + 2 > bytes.length || bytes[i] !== 0xff) throw new Error('jpeg: malformed marker');
    const start = i;
    // Fill bytes: any number of 0xFF before a marker (kept with the segment they precede).
    while (bytes[i + 1] === 0xff && i + 2 < bytes.length) i += 1;
    const marker = bytes[i + 1] ?? 0;
    if (marker === SOS) return { segments, scanStart: start };
    if (marker === EOI || marker === SOI || marker === 0x00) throw new Error('jpeg: no scan');
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, start, end: i + 2 });
      i += 2;
      continue;
    }
    if (i + 4 > bytes.length) throw new Error('jpeg: truncated segment');
    const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (length < 2 || i + 2 + length > bytes.length) throw new Error('jpeg: bad segment length');
    segments.push({ marker, start, end: i + 2 + length });
    i += 2 + length;
  }
};

/** The JPEG without its APP1-APP15 and COM segments; everything else is kept byte for byte. */
export const stripJpegMetadata = (bytes: Uint8Array): Buffer => {
  const { segments, scanStart } = jpegHeaderSegments(bytes);
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  for (const s of segments) {
    if (!isMetadataMarker(s.marker)) parts.push(bytes.subarray(s.start, s.end));
  }
  parts.push(bytes.subarray(scanStart));
  return Buffer.concat(parts);
};

/** The markers before the first scan, e.g. to assert that no metadata segment is left. */
export const headerMarkers = (bytes: Uint8Array): number[] =>
  jpegHeaderSegments(bytes).segments.map((s) => s.marker);
