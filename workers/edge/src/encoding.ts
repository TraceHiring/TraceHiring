// Byte helpers for candidate tokens, the OTP and the photo hash (specs/d1-demo-slice.md §4.3, §4.5). Web Crypto only.
// Nothing here logs or throws its input back.

const B64URL = /^[A-Za-z0-9_-]*$/;

/** base64url without padding (RFC 7515 §2). */
export const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Strict base64url decode: refuses padding and any character outside the alphabet. */
export const base64UrlDecode = (text: string): Uint8Array => {
  if (!B64URL.test(text) || text.length % 4 === 1) throw new Error('bad_base64url');
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
};

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');

/** Lower-case hex SHA-256 of bytes. */
export const sha256HexBytes = async (bytes: ArrayBuffer | Uint8Array): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', bytes));

/** Lower-case hex SHA-256 of a UTF-8 string. */
export const sha256Hex = (text: string): Promise<string> => sha256HexBytes(utf8(text));

/** `n` random bytes as base64url. */
export const randomBase64Url = (n: number): string =>
  base64UrlEncode(crypto.getRandomValues(new Uint8Array(n)));

/** Compares two strings in time that depends only on their lengths. */
export const constantTimeEqual = (a: string, b: string): boolean => {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
};
