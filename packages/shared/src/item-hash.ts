// The canonical content hash of an item version and of a variant (spec m1 R5-49 a), shared so that services/api and
// workers/jobs write the same item_versions.content_sha256 / item_variants content hash: SHA-256 of the canonical JSON
// of the served content only (format, stem, options as {id, text}, images as {hash, ext, alt}, and the param spec
// without correctOptionId). Every answer key is excluded, and an image is named by its content hash, not its org
// prefix, so a library copy (which keeps the library org's prefix and strips correctOptionId, SEC-M1-1) keeps its
// source's hash. Also the AI draft topic scrubber of §6.4 (the api scrubs before enqueue).
import { canonicalJson } from './canonical-json.js';

export interface HashOption {
  id: string;
  text: string;
}

export interface ItemHashInput {
  format: 'mcq' | 'written';
  stem: string;
  /** null for a written item. */
  options: readonly HashOption[] | null;
  /** item_versions.media: `{key: item-media/<org>/<sha256>.<ext>, alt}`; null or empty for none. */
  media: readonly { key: string; alt: string }[] | null;
  /** item_versions.param_spec, or null. Its top-level correctOptionId is left out. */
  paramSpec: Readonly<Record<string, unknown>> | null;
}

export interface VariantHashInput {
  stem: string;
  options: readonly HashOption[];
  params: Readonly<Record<string, number | string>>;
}

const MEDIA_KEY = /^item-media\/[0-9a-f-]{36}\/([0-9a-f]{64})\.(png|jpg|webp)$/;

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

const optionsOf = (options: readonly HashOption[]) =>
  options.map((o) => ({ id: o.id, text: o.text }));

/** The content hash of an item version (R5-49 a). Throws on an image key that is not an item-media key. */
export async function itemContentSha256(item: ItemHashInput): Promise<string> {
  const media = (item.media ?? []).map((m) => {
    const match = MEDIA_KEY.exec(m.key);
    if (match === null) throw new TypeError('itemContentSha256: bad image key');
    return { hash: match[1], ext: match[2], alt: m.alt };
  });
  let paramSpec: Record<string, unknown> | null = null;
  if (item.paramSpec !== null) {
    paramSpec = {};
    for (const key of Object.keys(item.paramSpec)) {
      if (key === 'correctOptionId') continue;
      Object.defineProperty(paramSpec, key, {
        value: item.paramSpec[key],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return sha256Hex(
    canonicalJson({
      v: 1,
      format: item.format,
      stem: item.stem,
      options: item.options === null ? null : optionsOf(item.options),
      media,
      paramSpec,
    }),
  );
}

/** The content hash of a generated variant (R5-49 a): its stem, options and params, never its correct option. */
export async function variantContentSha256(variant: VariantHashInput): Promise<string> {
  return sha256Hex(
    canonicalJson({
      v: 1,
      stem: variant.stem,
      options: optionsOf(variant.options),
      params: { ...variant.params },
    }),
  );
}

const REMOVED = '[removed]';
const MAX_TOPIC = 500;
const EMAIL = /[^\s@]+@[^\s@]+/g;
const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/gi;
/** A run of digits, spaces, dots, dashes, brackets and a leading plus that holds at least 8 digits (phone-like). */
const DIGIT_RUN = /\+?\d[\d\s().-]*\d/g;

/**
 * The AI draft topic as it may leave the api (§6.4): emails, URLs and phone-like digit runs (8 or more digits) are
 * replaced by `[removed]`, whitespace is collapsed, and the result is capped at 500 characters; never empty.
 */
export function scrubDraftTopic(topic: string): string {
  const scrubbed = topic
    .replace(URL_LIKE, REMOVED)
    .replace(EMAIL, REMOVED)
    .replace(DIGIT_RUN, (run) => (run.replace(/\D/g, '').length >= 8 ? REMOVED : run))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TOPIC);
  return scrubbed === '' ? REMOVED : scrubbed;
}

export interface SnapshotRow {
  sectionId: string;
  itemVersionId: string;
  exposureAtPublish: number;
}

/**
 * The digest of the publish snapshot a v2 package was built from (Wave 2 lead decision on the A1 database review's
 * publish race): rows sorted by section id, then item version id (byte order, as `collate "C"` in the guard), each
 * line `<sectionId>:<itemVersionId>:<exposureAtPublish>`, joined by a line feed; SHA-256 hex of the UTF-8 text. The
 * api sends it with the publish update and the guard recomputes it from the snapshot it writes, refusing a mismatch.
 */
export async function snapshotDigest(rows: readonly SnapshotRow[]): Promise<string> {
  const lines = rows
    .map((r) => {
      if (!Number.isSafeInteger(r.exposureAtPublish) || r.exposureAtPublish < 0) {
        throw new TypeError('snapshotDigest: bad exposure');
      }
      return `${r.sectionId.toLowerCase()}:${r.itemVersionId.toLowerCase()}:${String(r.exposureAtPublish)}`;
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sha256Hex(lines.join('\n'));
}
