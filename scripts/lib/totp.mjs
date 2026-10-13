// RFC 6238 TOTP (HMAC-SHA-1, 30-second steps) with WebCrypto, for the local auth test and the operator scripts
// (spec specs/m0b-tenancy.md §4.3). No dependency. A secret is never logged here.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding. */
export const base32Encode = (bytes) => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
};

/** RFC 4648 base32; case, spaces and `=` padding are ignored. */
export const base32Decode = (text) => {
  const clean = String(text).toUpperCase().replace(/[\s=]/g, '');
  if (clean.length === 0 || /[^A-Z2-7]/.test(clean)) throw new Error('totp: not a base32 secret');
  const out = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
};

/**
 * The TOTP code for a base32 secret at `timeMs` (default now).
 * @param {{ secret: string, timeMs?: number, digits?: 6 | 8, period?: number }} options
 * @returns {Promise<string>}
 */
export const totp = async ({ secret, timeMs = Date.now(), digits = 6, period = 30 }) => {
  if (digits !== 6 && digits !== 8) throw new Error('totp: digits must be 6 or 8');
  if (!Number.isFinite(timeMs) || timeMs < 0) throw new Error('totp: bad time');
  const counter = Math.floor(timeMs / 1000 / period);
  const message = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i -= 1) {
    message[i] = c % 256;
    c = Math.floor(c / 256);
  }
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = mac[mac.length - 1] & 15;
  const binary =
    ((mac[offset] & 127) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
};
