// member_invites.email_hmac (specs/m1-test-authoring.md R2-14, §3.2): HMAC-SHA-256 of the normalised address with the
// server pepper, 64 lower-case hex; compared in constant time.
import { describe, expect, it } from 'vitest';
import { hexEqual, hmacSha256Hex, inviteEmailHmac, normaliseInviteEmail } from './email-hmac.js';

describe('email HMAC', () => {
  it('hmacSha256Hex matches the RFC-style known vector', async () => {
    expect(await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });

  it('normalises by trimming and lower-casing the whole address', () => {
    expect(normaliseInviteEmail('  P-Someone@Example.TEST\t')).toBe('p-someone@example.test');
  });

  it('inviteEmailHmac is the HMAC of the normalised address, 64 hex', async () => {
    const pepper = ['synthetic', 'pepper'].join('-');
    const a = await inviteEmailHmac('p-someone@example.test', pepper);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await inviteEmailHmac(' P-SOMEONE@example.test ', pepper)).toBe(a);
    expect(await hmacSha256Hex(pepper, 'p-someone@example.test')).toBe(a);
    expect(await inviteEmailHmac('p-someone@example.test', `${pepper}x`)).not.toBe(a);
  });

  it('refuses an empty pepper', async () => {
    await expect(inviteEmailHmac('p-someone@example.test', '')).rejects.toThrow();
  });

  it('hexEqual compares equal-length hex only', () => {
    expect(hexEqual('ab'.repeat(32), 'ab'.repeat(32))).toBe(true);
    expect(hexEqual('ab'.repeat(32), 'ac'.repeat(32))).toBe(false);
    expect(hexEqual('ab'.repeat(32), 'ab'.repeat(31))).toBe(false);
    expect(hexEqual('AB'.repeat(32), 'ab'.repeat(32))).toBe(false);
  });
});
