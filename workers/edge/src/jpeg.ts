// JPEG checks for the start photo (specs/d1-demo-slice.md §4.5): the magic `FF D8 FF` and the frame size from the
// first SOFn segment. Reads marker headers only; never decodes pixels. Any malformed structure is "not a JPEG".

/** SOFn markers that carry the frame size (C4 DHT, C8 JPG and CC DAC are not frames). */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export const hasJpegMagic = (bytes: Uint8Array): boolean =>
  bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

/** The frame's width and height, or null when no well-formed SOFn segment comes before the scan. */
export const jpegDimensions = (bytes: Uint8Array): { width: number; height: number } | null => {
  if (!hasJpegMagic(bytes)) return null;
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
    if (marker === 0xd9 || marker === 0xda) return null; // end of image or start of scan before any frame
    const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (length < 2 || i + 2 + length > bytes.length) return null;
    if (SOF.has(marker)) {
      if (length < 7) return null;
      const height = ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0);
      const width = ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0);
      return { width, height };
    }
    i += 2 + length;
  }
  return null;
};
