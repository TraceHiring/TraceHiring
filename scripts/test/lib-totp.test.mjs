// Unit tests for scripts/lib/totp.mjs (spec specs/m0b-tenancy.md §4.3): RFC 6238 TOTP with WebCrypto, checked
// against the RFC's SHA-1 test vectors (Appendix B). The RFC seed is built at run time, never written as a literal.
import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, totp } from '../lib/totp.mjs';

const rfcSeed = new TextEncoder().encode('1234567890'.repeat(2));

describe('base32', () => {
  it('round-trips bytes (RFC 4648 alphabet, no padding)', () => {
    const encoded = base32Encode(rfcSeed);
    expect(encoded).toMatch(/^[A-Z2-7]+$/);
    expect(base32Decode(encoded)).toEqual(rfcSeed);
  });
  it('ignores case, spaces and padding', () => {
    const encoded = base32Encode(rfcSeed);
    const messy = `${encoded.toLowerCase().replace(/(.{4})/g, '$1 ')}====`;
    expect(base32Decode(messy)).toEqual(rfcSeed);
  });
  it('rejects characters outside the alphabet', () => {
    expect(() => base32Decode('ABC1')).toThrow(/base32/);
    expect(() => base32Decode('')).toThrow(/base32/);
  });
});

describe('totp()', () => {
  // RFC 6238 Appendix B, SHA-1 column, 8 digits.
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches the RFC 6238 vector at T=%i', async (seconds, expected) => {
    const secret = base32Encode(rfcSeed);
    await expect(totp({ secret, timeMs: seconds * 1000, digits: 8 })).resolves.toBe(expected);
    await expect(totp({ secret, timeMs: seconds * 1000 })).resolves.toBe(expected.slice(-6));
  });
  it('changes every 30 seconds', async () => {
    const secret = base32Encode(rfcSeed);
    const a = await totp({ secret, timeMs: 30_000 * 1000 });
    const b = await totp({ secret, timeMs: 30_000 * 1000 + 29_999 });
    const c = await totp({ secret, timeMs: 30_000 * 1000 + 30_000 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it('rejects an unsupported digit count or a bad time', async () => {
    const secret = base32Encode(rfcSeed);
    await expect(totp({ secret, timeMs: 0, digits: 5 })).rejects.toThrow(/digits/);
    await expect(totp({ secret, timeMs: -1 })).rejects.toThrow(/time/);
  });
});
