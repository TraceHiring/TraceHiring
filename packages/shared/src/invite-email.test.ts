// member_invites.email_hmac (specs/m1-test-authoring.md R2-14, §3.2): one definition for the api (writes the invite)
// and the jobs member provisioning (checks it). HMAC-SHA-256 of the normalised address keyed with the pepper's UTF-8
// bytes, 64 lower-case hex; compared in constant time.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SIGNING_KEY_INVALID,
  hexEqual,
  hmacSha256Hex,
  hmacSha256HexKey,
  inviteEmailHmac,
  normaliseInviteEmail,
  PEPPER_MIN_BYTES,
  pepperStrongEnough,
} from './invite-email.js';

describe('invite email HMAC (shared by the api and the jobs, A3b lead ask)', () => {
  it('hmacSha256Hex matches the RFC-style known vector', async () => {
    expect(await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });

  // M2 Wave 1 lead decision (build-notes 2026-10-31 "Wave 1 lead part" a): the blind-index key arrives from
  // KeyManager as a CryptoKey (HMAC, SHA-256), never as text; same digest as the string-key form for the same bytes.
  it('hmacSha256HexKey signs with an HMAC CryptoKey and equals hmacSha256Hex for the same key bytes', async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('key'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const message = 'The quick brown fox jumps over the lazy dog';
    expect(await hmacSha256HexKey(key, message)).toBe(await hmacSha256Hex('key', message));
    expect(await hmacSha256HexKey(key, message)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hmacSha256HexKey refuses a key that is not an HMAC SHA-256 signing key', async () => {
    const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
    ]);
    await expect(hmacSha256HexKey(aes, 'x')).rejects.toThrow(SIGNING_KEY_INVALID);
    const sha1 = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(32),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    await expect(hmacSha256HexKey(sha1, 'x')).rejects.toThrow(SIGNING_KEY_INVALID);
  });

  it('normalises by trimming and lower-casing the whole address', () => {
    expect(normaliseInviteEmail('  P-Someone@Example.TEST\t')).toBe('p-someone@example.test');
  });

  it('inviteEmailHmac equals node:crypto HMAC-SHA-256 of the normalised address', async () => {
    const pepper = ['synthetic', 'pepper', 'for', 'tests'].join('-');
    const expected = createHmac('sha256', Buffer.from(pepper, 'utf8'))
      .update('p-someone@example.test', 'utf8')
      .digest('hex');
    expect(await inviteEmailHmac(' P-SOMEONE@example.test ', pepper)).toBe(expected);
    expect(await inviteEmailHmac('p-someone@example.test', `${pepper}x`)).not.toBe(expected);
  });

  it('pepperStrongEnough: at least PEPPER_MIN_BYTES (32) UTF-8 bytes, the one rule for the api and the jobs', () => {
    expect(PEPPER_MIN_BYTES).toBe(32);
    expect(pepperStrongEnough('x'.repeat(32))).toBe(true);
    expect(pepperStrongEnough('x'.repeat(31))).toBe(false);
    expect(pepperStrongEnough('é'.repeat(16))).toBe(true); // 32 bytes in 16 characters
    expect(pepperStrongEnough(undefined)).toBe(false);
  });

  it('refuses an empty pepper', async () => {
    await expect(inviteEmailHmac('p-someone@example.test', '')).rejects.toThrow();
  });

  it('hexEqual compares equal-length lower-case hex only', () => {
    expect(hexEqual('ab'.repeat(32), 'ab'.repeat(32))).toBe(true);
    expect(hexEqual('ab'.repeat(32), 'ac'.repeat(32))).toBe(false);
    expect(hexEqual('ab'.repeat(32), 'ab'.repeat(31))).toBe(false);
    expect(hexEqual('AB'.repeat(32), 'ab'.repeat(32))).toBe(false);
  });
});
