// Pure helpers of scripts/test-auth-local.mjs (specs/m0b-tenancy.md AT-B8). The end-to-end run itself
// needs the local stack and runs inside `pnpm test:rls`. Synthetic values only.
import { describe, expect, it } from 'vitest';
import { INVOKER_ROWS, amrMethods, claimsOf, codeIn, invokerVerdict } from '../test-auth-local.mjs';

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

describe('invokerVerdict (DC-M1-1, specs/m1-test-authoring.md §8)', () => {
  const highData = { accepted: 0, errors: [{ rowNo: 2, field: 'stem', code: 'missing_field' }] };
  const ok = { low: 409, high: 200, highData, after: 'validating 1' };

  it('sends one error-only row, so the call needs no content', () => {
    expect(INVOKER_ROWS).toEqual([
      { rowNo: 2, errors: [{ field: 'stem', code: 'missing_field' }] },
    ]);
  });

  it('passes when aal2 is accepted, aal1 is hidden by RLS (409) and the guards wrote the batch', () => {
    expect(invokerVerdict(ok)).toBeNull();
  });

  it('names the failing half without echoing a body', () => {
    expect(invokerVerdict({ ...ok, high: 403 })).toBe('the aal2 call returned HTTP 403');
    expect(invokerVerdict({ ...ok, highData: { accepted: 1, errors: [] } })).toBe(
      'the aal2 call returned an unexpected result',
    );
    expect(invokerVerdict({ ...ok, highData: null })).toBe(
      'the aal2 call returned an unexpected result',
    );
    expect(invokerVerdict({ ...ok, low: 200 })).toBe(
      'the aal1 call returned HTTP 200, expected 409 (RLS hides the job)',
    );
    expect(invokerVerdict({ ...ok, low: null })).toMatch(/HTTP network error, expected 409/);
    expect(invokerVerdict({ ...ok, after: 'open 0' })).toBe(
      'the job is not validating with one stored error row',
    );
    expect(invokerVerdict({ ...ok, after: null })).toBe(
      'the job is not validating with one stored error row',
    );
  });
});
