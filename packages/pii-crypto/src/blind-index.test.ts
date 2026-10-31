// AT-M2-15 (per-org blind index differs, domain separation) and E4 (no cross-org match): HMAC-SHA-256 blind indexes
// with the per-org bidx key (specs/m2-scheduling-invites.md M2-3, M2-5, §3.2; build-notes 2026-10-31 a, b). Keys are
// generated per run. Synthetic data only.
import { hmacSha256HexKey } from '@trace/shared/invite-email';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BLIND_INDEX_RE,
  PiiCryptoError,
  blindIndexEqual,
  contactFingerprint,
  emailBlindIndex,
  phoneBlindIndex,
} from './index.js';

type Key = Parameters<typeof crypto.subtle.sign>[1];
let bidxA: Key;
let bidxB: Key;
let aesKey: Key;

beforeAll(async () => {
  const gen = () => crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  bidxA = await gen();
  bidxB = await gen();
  aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
});

const EMAIL = 'candidate.1@example.test';
const PHONE = '+919876543210';

describe('blind indexes', () => {
  it('are 64 lower-case hex and deterministic per key', async () => {
    const a1 = await emailBlindIndex(bidxA, EMAIL);
    const a2 = await emailBlindIndex(bidxA, EMAIL);
    expect(a1).toMatch(BLIND_INDEX_RE);
    expect(a1).toBe(a2);
    expect(blindIndexEqual(a1, a2)).toBe(true);
    expect(await phoneBlindIndex(bidxA, PHONE)).toMatch(BLIND_INDEX_RE);
    expect(await contactFingerprint(bidxA, EMAIL)).toMatch(BLIND_INDEX_RE);
  });

  it('use the domain-separated messages email:, phone: and candidate: (decision a)', async () => {
    expect(await emailBlindIndex(bidxA, EMAIL)).toBe(
      await hmacSha256HexKey(bidxA, `email:${EMAIL}`),
    );
    expect(await phoneBlindIndex(bidxA, PHONE)).toBe(
      await hmacSha256HexKey(bidxA, `phone:${PHONE}`),
    );
    expect(await contactFingerprint(bidxA, EMAIL)).toBe(
      await hmacSha256HexKey(bidxA, `candidate:${EMAIL}`),
    );
  });

  it('separate the domains: the email index, the fingerprint and the phone index of one value all differ', async () => {
    const v = 'same-value';
    const e = await emailBlindIndex(bidxA, `${v}@example.test`);
    const f = await contactFingerprint(bidxA, `${v}@example.test`);
    expect(blindIndexEqual(e, f)).toBe(false);
    // An email-shaped and a phone-shaped input that share the raw text still differ by domain.
    const p = await phoneBlindIndex(bidxA, PHONE);
    const pAsEmail = await hmacSha256HexKey(bidxA, `email:${PHONE}`);
    expect(blindIndexEqual(p, pAsEmail)).toBe(false);
  });

  it('differ per org key: the same address in two orgs never matches (E4)', async () => {
    const a = await emailBlindIndex(bidxA, EMAIL);
    const b = await emailBlindIndex(bidxB, EMAIL);
    expect(blindIndexEqual(a, b)).toBe(false);
    expect(
      blindIndexEqual(await phoneBlindIndex(bidxA, PHONE), await phoneBlindIndex(bidxB, PHONE)),
    ).toBe(false);
    expect(
      blindIndexEqual(
        await contactFingerprint(bidxA, EMAIL),
        await contactFingerprint(bidxB, EMAIL),
      ),
    ).toBe(false);
  });

  it('refuse a value that is not normalised (the caller normalises first)', async () => {
    for (const [fn, v] of [
      [emailBlindIndex, 'Candidate.1@Example.TEST'],
      [emailBlindIndex, ' candidate.1@example.test'],
      [contactFingerprint, 'not an address'],
      [phoneBlindIndex, '9876543210'],
      [phoneBlindIndex, '+91 98765 43210'],
    ] as const) {
      const e = await fn(bidxA, v).catch((err: unknown) => err);
      expect(e).toBeInstanceOf(PiiCryptoError);
      expect((e as PiiCryptoError).code).toBe('bad_context');
    }
  });

  it('refuse a key that is not an HMAC SHA-256 signing key', async () => {
    const e = await emailBlindIndex(aesKey, EMAIL).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(PiiCryptoError);
    expect((e as PiiCryptoError).code).toBe('key_invalid');
  });

  it('blindIndexEqual is false for anything that is not two 64-hex digests', () => {
    const h = 'a'.repeat(64);
    expect(blindIndexEqual(h, h)).toBe(true);
    expect(blindIndexEqual(h, 'A'.repeat(64))).toBe(false);
    expect(blindIndexEqual('', '')).toBe(false);
  });
});
