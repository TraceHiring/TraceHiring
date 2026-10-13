// Pure helpers of scripts/test-auth-local.mjs (specs/m0b-tenancy.md AT-B8). The end-to-end run itself
// needs the local stack and runs inside `pnpm test:rls`. Synthetic values only.
import { describe, expect, it } from 'vitest';
import { amrMethods, claimsOf, codeIn } from '../test-auth-local.mjs';

const token = (payload) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

describe('claimsOf', () => {
  it('decodes the payload of a three-part token', () => {
    expect(claimsOf(token({ aal: 'aal2', sub: 'x' }))).toEqual({ aal: 'aal2', sub: 'x' });
  });

  it.each([undefined, '', 'a', 'a.!!!.c', 'a.bm90IGpzb24.c'])('returns null for %s', (t) => {
    expect(claimsOf(t)).toBeNull();
  });
});

describe('amrMethods', () => {
  it('compares methods as a sorted set, whatever order GoTrue uses', () => {
    const amr = [
      { method: 'totp', timestamp: 2 },
      { method: 'password', timestamp: 1 },
      { method: 'totp', timestamp: 3 },
    ];
    expect(amrMethods({ amr })).toEqual(['password', 'totp']);
  });

  it('treats a missing or malformed amr as no methods', () => {
    expect(amrMethods({})).toEqual([]);
    expect(amrMethods({ amr: 'otp' })).toEqual([]);
    expect(amrMethods(null)).toEqual([]);
  });
});

describe('codeIn', () => {
  it('finds the 6-digit code in the email text', () => {
    expect(codeIn('Enter this code to sign in to Trace:\n\n123456\n\nThe code expires')).toBe(
      '123456',
    );
  });

  it('ignores longer digit runs and returns null without a code', () => {
    expect(codeIn('order 1234567 then 654321')).toBe('654321');
    expect(codeIn('no code here')).toBeNull();
    expect(codeIn(undefined)).toBeNull();
  });
});
