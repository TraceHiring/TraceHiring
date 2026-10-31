// Images found in an import file (spec §6.9, E11, E12): the type comes from the bytes, never from the name; the
// SHA-256 is computed in the browser and is the content address the api re-checks. Same bytes = one upload.
import type { ImportImageType } from '../../api/client';
import type { ImagePart, SkippedImage } from './protocol';

export function sniffImageType(bytes: Uint8Array): ImportImageType | null {
  const startsWith = (sig: readonly number[], at = 0): boolean =>
    bytes.length >= at + sig.length && sig.every((b, i) => bytes[at + i] === b);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return null;
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A copy that owns its buffer, in the exact type the api client sends. */
export function ownBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.length));
  copy.set(bytes);
  return copy;
}

export interface PreparedImage {
  sha256: string;
  type: ImportImageType;
  bytes: Uint8Array<ArrayBuffer>;
}

export type ImageLookup =
  | { status: 'found'; image: PreparedImage }
  | { status: 'missing' | 'too_large' | 'bad_type' | 'ambiguous' | 'invalid' };

export interface ImageIndex {
  lookup(reference: string): ImageLookup;
  /** Images in the file, however they are used. */
  readonly count: number;
}

type Entry = ImageLookup;

/** Index the images of a file by their full path and by their base name, both case-insensitive. */
export async function buildImageIndex(
  images: readonly ImagePart[],
  skipped: readonly SkippedImage[],
): Promise<ImageIndex> {
  const byFull = new Map<string, Entry>();
  const byBase = new Map<string, Entry[]>();
  const prepared = new Map<string, PreparedImage>();
  const add = (name: string, entry: Entry): void => {
    const full = name.toLowerCase();
    byFull.set(full, entry);
    const base = full.slice(full.lastIndexOf('/') + 1);
    byBase.set(base, [...(byBase.get(base) ?? []), entry]);
  };
  for (const image of images) {
    const type = sniffImageType(image.bytes);
    if (type === null) {
      add(image.name, { status: 'bad_type' });
      continue;
    }
    const bytes = ownBytes(image.bytes);
    const sha256 = await sha256Hex(bytes);
    const known = prepared.get(sha256) ?? { sha256, type, bytes };
    prepared.set(sha256, known);
    add(image.name, { status: 'found', image: known });
  }
  for (const image of skipped) add(image.name, { status: 'too_large' });

  return {
    count: images.length + skipped.length,
    lookup(reference) {
      const cleaned = reference
        .trim()
        .replaceAll('\\', '/')
        .replace(/^(?:\.\/)+/, '');
      if (
        cleaned === '' ||
        cleaned.startsWith('/') ||
        // eslint-disable-next-line no-control-regex
        /[\u0000-\u001f]/.test(cleaned) ||
        cleaned.split('/').includes('..')
      ) {
        return { status: cleaned === '' ? 'missing' : 'invalid' };
      }
      const lower = cleaned.toLowerCase();
      const exact = byFull.get(lower);
      if (exact !== undefined) return exact;
      const base = lower.slice(lower.lastIndexOf('/') + 1);
      const same = byBase.get(base) ?? [];
      if (same.length === 1 && same[0] !== undefined) return same[0];
      return { status: same.length > 1 ? 'ambiguous' : 'missing' };
    },
  };
}
