// member_invites.email_hmac (specs/m1-test-authoring.md R2-14, §3.2): one definition for the api (writes the invite)
// and the jobs member provisioning (checks it). HMAC-SHA-256 of the normalised address keyed with the pepper's UTF-8
// bytes, 64 lower-case hex; compared in constant time.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  hexEqual,
  hmacSha256Hex,
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
