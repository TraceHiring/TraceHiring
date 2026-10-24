// Item images (specs/m1-test-authoring.md R5-10, R5-66 e; AT-M1-32): the bytes come only through the API client's
// media route (the one network module); here they are checked once more (type allow-list, hash) and shown as a
// `data:` URL, so the candidate CSP (`img-src 'self' data:`) is unchanged. No object URL, never written to any
// storage: the URL lives in component state only and goes with the screen. Any failure is null, and the screen shows
// one neutral line with the item's alt text. Nothing here logs.
import { ITEM_IMAGE_TYPES, type CandidateApi } from '../api';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 with padding (RFC 4648 §4), without building one huge string for btoa. */
export const base64Of = (bytes: Uint8Array): string => {
  const out: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out.push(
      (ALPHABET[(n >> 18) & 63] ?? '') +
        (ALPHABET[(n >> 12) & 63] ?? '') +
        (ALPHABET[(n >> 6) & 63] ?? '') +
        (ALPHABET[n & 63] ?? ''),
    );
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out.push((ALPHABET[(n >> 18) & 63] ?? '') + (ALPHABET[(n >> 12) & 63] ?? '') + '==');
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out.push(
      (ALPHABET[(n >> 18) & 63] ?? '') +
        (ALPHABET[(n >> 12) & 63] ?? '') +
        (ALPHABET[(n >> 6) & 63] ?? '') +
        '=',
    );
  }
  return out.join('');
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

/** The image as a `data:` URL, or null when it cannot be shown (refused, wrong type, wrong bytes, offline). */
export const itemImageUrl = async (
  api: Pick<CandidateApi, 'media'>,
  sessionToken: string,
  hash: string,
): Promise<string | null> => {
  try {
    const res = await api.media(sessionToken, hash);
    if (!res.ok) return null;
    const { type, bytes } = res.value;
    if (!(ITEM_IMAGE_TYPES as readonly string[]).includes(type)) return null;
    if ((await sha256Hex(bytes)) !== hash) return null;
    return `data:${type};base64,${base64Of(bytes)}`;
  } catch {
    return null;
  }
};
