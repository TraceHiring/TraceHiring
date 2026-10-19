// RFC 6238 TOTP (HMAC-SHA-1, 30-second steps, 6 digits) for the E2E sign-ins (specs/d1-demo-slice.md §7.2: the
// e2e package has its own helper and imports nothing from another element). A secret is never logged here.
import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32; case, spaces and `=` padding are ignored. */
export const base32Decode = (text: string): Buffer => {
  const clean = text.toUpperCase().replace(/[\s=]/g, '');
  if (clean.length === 0 || /[^A-Z2-7]/.test(clean)) throw new Error('totp: not a base32 secret');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = ((value << 5) | ALPHABET.indexOf(ch)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

/** The 6-digit code for a base32 secret at `timeMs`. */
export const totp = (secret: string, timeMs: number = Date.now()): string => {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30_000)));
  const mac = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
};
