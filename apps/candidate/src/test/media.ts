// Item images (specs/m1-test-authoring.md R5-10, R5-66 e; AT-M1-32): the bytes come only through the API client's
// media route (the one network module); here they are checked once more (type allow-list, hash) and shown as a
// `data:` URL, so the candidate CSP (`img-src 'self' data:`) is unchanged. No object URL, never written to any
// storage: the URL lives in component state only and goes with the screen. A 404 or bad media shows one neutral line
// with the item's alt text; a network failure, 429 or 503 is retried first (R5-68 c). Nothing here logs.
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

export const IMAGE_RETRY = {
  /** Requests per image before "Try again" shows (the first one included). */
  tries: 4,
  /** Waits between tries; a 429's Retry-After wins (capped). */
  backoffMs: [1_000, 2_000, 4_000],
  maxRetryAfterMs: 60_000,
} as const;

/** One image's outcome: shown, final (404 or bad media: the line), or failed for now (the line with "Try again"). */
export type ImageLoad = { kind: 'ok'; url: string } | { kind: 'final' } | { kind: 'failed' };

type Attempt = ImageLoad | { kind: 'retry'; waitMs?: number };

const attempt = async (
  api: Pick<CandidateApi, 'media'>,
  sessionToken: string,
  hash: string,
): Promise<Attempt> => {
  const res = await api.media(sessionToken, hash);
  if (!res.ok) {
    // 404 (unknown, not served, or passed) and bad media are final; so is the client's own refusal of the hash.
    if (res.status === 404 || res.code === 'bad_media' || res.code === 'bad_request')
      return { kind: 'final' };
    if (res.code === 'network' || res.code === 'unavailable' || res.status === 503)
      return { kind: 'retry' };
    if (res.status === 429) {
      return res.retryAfterSeconds === undefined
        ? { kind: 'retry' }
        : {
            kind: 'retry',
            waitMs: Math.min(res.retryAfterSeconds * 1_000, IMAGE_RETRY.maxRetryAfterMs),
          };
    }
    return { kind: 'failed' };
  }
  const { type, bytes } = res.value;
  if (!(ITEM_IMAGE_TYPES as readonly string[]).includes(type)) return { kind: 'final' };
  if ((await sha256Hex(bytes)) !== hash) return { kind: 'final' };
  return { kind: 'ok', url: `data:${type};base64,${base64Of(bytes)}` };
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The image as a `data:` URL (R5-66 e, R5-68 c). A 404 or bad media (type, size, hash) is final; a network failure, a
 * 429 (its Retry-After wins) or a 503 is retried with backoff, at most `IMAGE_RETRY.tries` requests, then `failed`
 * ("Try again"); any other answer is `failed` at once. `alive` false stops the retries (the screen is gone).
 */
export const loadItemImage = async (
  api: Pick<CandidateApi, 'media'>,
  sessionToken: string,
  hash: string,
  opts: { sleep?: (ms: number) => Promise<void>; alive?: () => boolean } = {},
): Promise<ImageLoad> => {
  const sleep = opts.sleep ?? realSleep;
  const alive = opts.alive ?? (() => true);
  for (let k = 0; ; k += 1) {
    let res: Attempt;
    try {
      res = await attempt(api, sessionToken, hash);
    } catch {
      return { kind: 'final' };
    }
    if (res.kind !== 'retry') return res;
    if (k + 1 >= IMAGE_RETRY.tries) return { kind: 'failed' };
    await sleep(res.waitMs ?? IMAGE_RETRY.backoffMs[k] ?? 4_000);
    if (!alive()) return { kind: 'failed' };
  }
};
