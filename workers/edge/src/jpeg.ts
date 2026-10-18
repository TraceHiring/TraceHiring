// JPEG checks for the start photo (specs/d1-demo-slice.md §4.5, rule 8): the magic `FF D8 FF`, the frame size from the
// SOFn segment, and "only the processed JPEG": the marker segments before the first scan may not carry APP1-APP15
// (EXIF, XMP, ICC, thumbnails) or COM, and the body must end with EOI `FF D9` (no bytes after the image). Reads marker
// headers only; never decodes pixels and never parses the entropy-coded scan. Any malformed structure is "not a JPEG".

/** SOFn markers that carry the frame size (C4 DHT, C8 JPG and CC DAC are not frames). */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const APP0 = 0xe0;
const COM = 0xfe;
const SOS = 0xda;
const EOI = 0xd9;

/** APP1-APP15 and COM: metadata a canvas-encoded, blurred JPEG never needs. */
const isForbidden = (marker: number): boolean =>
  (marker > APP0 && marker <= 0xef) || marker === COM;

export const hasJpegMagic = (bytes: Uint8Array): boolean =>
  bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

const endsWithEoi = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === EOI;

/**
 * The frame's width and height, or null unless: one well-formed SOFn segment comes before the first scan, no segment
 * before the scan is APP1-APP15 or COM, and the body ends with `FF D9`.
 */
export const jpegDimensions = (bytes: Uint8Array): { width: number; height: number } | null => {
  if (!hasJpegMagic(bytes) || !endsWithEoi(bytes)) return null;
  let size: { width: number; height: number } | null = null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let marker = bytes[i + 1] ?? 0;
    // Fill bytes: any number of 0xFF before a marker.
    while (marker === 0xff && i + 2 < bytes.length) {
      i += 1;
      marker = bytes[i + 1] ?? 0;
    }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === EOI) return null; // end of image before any scan
    if (marker === SOS) return size; // the header ends here; the scan is not parsed
    if (isForbidden(marker)) return null;
    const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (length < 2 || i + 2 + length > bytes.length) return null;
    if (SOF.has(marker)) {
      if (length < 7 || size !== null) return null; // a short frame header, or a second frame
      const height = ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0);
      const width = ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0);
      size = { width, height };
    }
    i += 2 + length;
  }
  return null;
};
