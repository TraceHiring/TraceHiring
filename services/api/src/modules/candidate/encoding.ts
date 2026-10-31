// Byte helpers for the candidate token and the link-token hash (spec §4.3). Web Crypto only, so the module stays
// runtime-agnostic (ADR-027). Nothing here logs or throws input back.

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

/** Lower-case hex SHA-256 of a UTF-8 string. */
export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', utf8(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

/** `n` random bytes as base64url (the 32-byte link token is 43 characters). */
export const randomBase64Url = (n: number): string =>
  base64UrlEncode(crypto.getRandomValues(new Uint8Array(n)));
