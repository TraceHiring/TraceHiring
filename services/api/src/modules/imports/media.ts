// Item images of an import (spec m1 §6.9, M1-9, R2-19, R5-55 d, SEC-M1-5; E11, E12): content-addressed objects in the
// private ITEM_MEDIA bucket at `item-media/{org}/{sha256}.{ext}`. The api reads only the first bytes it needs: the
// magic bytes decide the type (PNG, JPEG or WebP, never the client's word alone) and the header gives the size in
// pixels (at most 4096 a side). The bucket is injected (ItemMediaStore) so tests run without R2; a stored object is
// never served from here (the edge serves images to candidates, R5-10).

export interface ItemMediaStore {
  /** The stored object's size and content type, or null when there is none. */
  head(key: string): Promise<{ size: number; contentType: string | null } | null>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

/** The production store: the ITEM_MEDIA R2 binding, or null when unbound (the routes answer 503). */
export const itemMediaFromEnv = (env: Env): ItemMediaStore | null => {
  const bucket = env.ITEM_MEDIA;
  if (bucket === undefined) return null;
  return {
    async head(key) {
      const object = await bucket.head(key);
      return object === null
        ? null
        : { size: object.size, contentType: object.httpMetadata?.contentType ?? null };
    },
    async put(key, bytes, contentType) {
      await bucket.put(key, bytes, { httpMetadata: { contentType } });
    },
  };
};

export type ImageExt = 'png' | 'jpg' | 'webp';

/** The stored extension of each accepted content type (ItemMedia key, §5). */
export const IMAGE_TYPES: Readonly<Record<ImageExt, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

/** §6.9: at most 4096 pixels a side. */
export const MAX_IMAGE_SIDE = 4096;

export interface SniffedImage {
  ext: ImageExt;
  /** Null when the header does not name a size (the image is refused). */
  width: number | null;
  height: number | null;
}

const u16be = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u32be = (b: Uint8Array, i: number) => u16be(b, i) * 65536 + u16be(b, i + 2);
const u24le = (b: Uint8Array, i: number) =>
  (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
const ascii = (b: Uint8Array, i: number, text: string) =>
  [...text].every((ch, k) => b[i + k] === ch.charCodeAt(0));

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** JPEG start-of-frame markers (not DHT C4, JPG C8 or DAC CC). */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const jpegSize = (b: Uint8Array): { width: number; height: number } | null => {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (SOF.has(marker)) return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
};

const webpSize = (b: Uint8Array): { width: number; height: number } | null => {
  if (ascii(b, 12, 'VP8X') && b.length >= 30) {
    return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  }
  if (ascii(b, 12, 'VP8L') && b.length >= 25 && b[20] === 0x2f) {
    const b0 = b[21] ?? 0;
    const b1 = b[22] ?? 0;
    const b2 = b[23] ?? 0;
    const b3 = b[24] ?? 0;
    return {
      width: 1 + (b0 | ((b1 & 0x3f) << 8)),
      height: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)),
    };
  }
  if (ascii(b, 12, 'VP8 ') && b.length >= 30) {
    return {
      width: ((b[26] ?? 0) | ((b[27] ?? 0) << 8)) & 0x3fff,
      height: ((b[28] ?? 0) | ((b[29] ?? 0) << 8)) & 0x3fff,
    };
  }
  return null;
};

/** The image type from its magic bytes and its size from its header, or null for anything else. */
export const sniffImage = (b: Uint8Array): SniffedImage | null => {
  if (b.length >= 24 && PNG_SIGNATURE.every((v, i) => b[i] === v) && ascii(b, 12, 'IHDR')) {
    return { ext: 'png', width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const size = jpegSize(b);
    return { ext: 'jpg', width: size?.width ?? null, height: size?.height ?? null };
  }
  if (b.length >= 16 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) {
    const size = webpSize(b);
    return { ext: 'webp', width: size?.width ?? null, height: size?.height ?? null };
  }
  return null;
};

/** The content-addressed key of an image (§6.9). */
export const mediaKeyOf = (orgId: string, sha256: string, ext: ImageExt): string =>
  `item-media/${orgId}/${sha256}.${ext}`;
