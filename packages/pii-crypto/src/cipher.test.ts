// AT-M2-15 (round trip, tamper detection, AAD binding) and E22: AES-256-GCM field encryption with the per-org data
// key (specs/m2-scheduling-invites.md M2-3, §3.2 ciphertext CHECKs; build-notes 2026-10-31 "Wave 1 lead part" b).
// Keys are generated per run (no key material in source). Synthetic data only.
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CIPHERTEXT_MAX_LENGTH,
  CIPHERTEXT_RE,
  PiiCryptoError,
  ciphertextKeyVersion,
  decryptField,
  encryptField,
} from './index.js';
import type { FieldContext } from './index.js';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const ORG_B = '00000000-0000-4000-8000-0000000000b2';

type Key = Parameters<typeof crypto.subtle.encrypt>[1];
let keyA: Key;
let keyB: Key;
let hmacKey: Key;

beforeAll(async () => {
  const gen = () =>
    crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  keyA = await gen();
  keyB = await gen();
  hmacKey = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
});

const ctx = (patch: Partial<FieldContext> = {}): FieldContext => ({
  orgId: ORG_A,
  field: 'email',
  keyVersion: 1,
  ...patch,
});

const b64urlDecode = (s: string): Uint8Array =>
  Uint8Array.from(
    atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)),
    (c) => c.charCodeAt(0),
  );
const b64urlEncode = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** Rebuilds a ciphertext with one byte of its payload flipped. */
const flipByte = (ct: string, index: (len: number) => number): string => {
  const [v, kv, body] = ct.split('.') as [string, string, string];
  const bytes = b64urlDecode(body);
  const i = index(bytes.length);
  bytes[i] = (bytes[i] as number) ^ 0x01;
  return `${v}.${kv}.${b64urlEncode(bytes)}`;
};

const expectDecryptFailed = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(PiiCryptoError);
  expect((e as PiiCryptoError).code).toBe('decrypt_failed');
  expect((e as Error).message).toBe('pii-crypto: decrypt_failed');
};

describe('encryptField / decryptField round trip', () => {
  it('round trips and matches the v1 ciphertext shape', async () => {
    const ct = await encryptField(keyA, ctx(), 'candidate.1@example.test');
    expect(ct).toMatch(CIPHERTEXT_RE);
    expect(ct.startsWith('v1.1.')).toBe(true);
    expect(ct.length).toBeLessThanOrEqual(CIPHERTEXT_MAX_LENGTH);
    expect(await decryptField(keyA, { orgId: ORG_A, field: 'email' }, ct)).toBe(
      'candidate.1@example.test',
    );
  });

  it('pins the CHECK pattern and the length limit of the ciphertext columns', () => {
    expect(CIPHERTEXT_RE.source).toBe('^v1\\.[0-9]+\\.[A-Za-z0-9_-]+$');
    expect(CIPHERTEXT_MAX_LENGTH).toBe(2048);
  });

  it('records the key version in the prefix', async () => {
    const ct = await encryptField(keyA, ctx({ keyVersion: 7 }), 'x');
    expect(ct.startsWith('v1.7.')).toBe(true);
    expect(ciphertextKeyVersion(ct)).toBe(7);
    expect(await decryptField(keyA, { orgId: ORG_A, field: 'email' }, ct)).toBe('x');
  });

  it('uses a fresh random IV for every value (same plaintext, different ciphertext)', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(await encryptField(keyA, ctx(), 'same'));
    expect(seen.size).toBe(50);
    const ivs = new Set(
      [...seen].map((ct) => b64urlEncode(b64urlDecode(ct.split('.')[2] as string).slice(0, 12))),
    );
    expect(ivs.size).toBe(50);
  });

  it('round trips Devanagari and Tamil names (E22)', async () => {
    for (const name of ['परीक्षा उम्मीदवार', 'சோதனை வேட்பாளர்', 'Test Ñame [synthetic]']) {
      const c = ctx({ field: 'full_name' });
      const ct = await encryptField(keyA, c, name);
      expect(await decryptField(keyA, { orgId: ORG_A, field: 'full_name' }, ct)).toBe(name);
    }
  });

  it('round trips any string of up to 200 graphemes within the 2,048-character limit (property)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ unit: 'grapheme', maxLength: 200 }), async (text) => {
        fc.pre(text.length > 0 && new TextEncoder().encode(text).length <= 1024);
        const ct = await encryptField(keyA, ctx({ field: 'full_name' }), text);
        expect(ct).toMatch(CIPHERTEXT_RE);
        expect(ct.length).toBeLessThanOrEqual(CIPHERTEXT_MAX_LENGTH);
        expect(await decryptField(keyA, { orgId: ORG_A, field: 'full_name' }, ct)).toBe(text);
      }),
      { numRuns: 200 },
    );
  });

  it('refuses a plaintext over 1,024 UTF-8 bytes and an empty one', async () => {
    for (const text of ['', 'a'.repeat(1025), 'त'.repeat(342)]) {
      const e = await encryptField(keyA, ctx(), text).catch((err: unknown) => err);
      expect(e).toBeInstanceOf(PiiCryptoError);
      expect((e as PiiCryptoError).code).toBe('plaintext_invalid');
    }
    // 1,024 bytes exactly is accepted and still fits.
    const ct = await encryptField(keyA, ctx(), 'a'.repeat(1024));
    expect(ct.length).toBeLessThanOrEqual(CIPHERTEXT_MAX_LENGTH);
  });
});

describe('context validation', () => {
  it.each([
    [{ orgId: 'not-a-uuid' }],
    [{ orgId: ORG_A.toUpperCase() }],
    [{ field: 'address' as never }],
    [{ keyVersion: 0 }],
    [{ keyVersion: -1 }],
    [{ keyVersion: 1.5 }],
    [{ keyVersion: 2 ** 31 }],
  ])('refuses %j with bad_context', async (patch) => {
    const e = await encryptField(keyA, ctx(patch as Partial<FieldContext>), 'x').catch(
      (err: unknown) => err,
    );
    expect(e).toBeInstanceOf(PiiCryptoError);
    expect((e as PiiCryptoError).code).toBe('bad_context');
  });

  it('refuses a key that is not an AES-GCM encryption key', async () => {
    const e = await encryptField(hmacKey, ctx(), 'x').catch((err: unknown) => err);
    expect(e).toBeInstanceOf(PiiCryptoError);
    expect((e as PiiCryptoError).code).toBe('key_invalid');
  });
});

describe('tamper detection: every failure is the one constant decrypt_failed code', () => {
  let ct: string;
  beforeAll(async () => {
    ct = await encryptField(keyA, ctx(), 'candidate.1@example.test');
  });

  it('a flipped IV byte fails', async () => {
    await expectDecryptFailed(
      decryptField(
        keyA,
        { orgId: ORG_A, field: 'email' },
        flipByte(ct, () => 0),
      ),
    );
    await expectDecryptFailed(
      decryptField(
        keyA,
        { orgId: ORG_A, field: 'email' },
        flipByte(ct, () => 11),
      ),
    );
  });

  it('a flipped body byte fails', async () => {
    await expectDecryptFailed(
      decryptField(
        keyA,
        { orgId: ORG_A, field: 'email' },
        flipByte(ct, () => 13),
      ),
    );
  });

  it('a flipped tag byte fails', async () => {
    await expectDecryptFailed(
      decryptField(
        keyA,
        { orgId: ORG_A, field: 'email' },
        flipByte(ct, (n) => n - 1),
      ),
    );
  });

  it('any single flipped byte fails (property)', async () => {
    const len = b64urlDecode(ct.split('.')[2] as string).length;
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: len - 1 }), async (i) => {
        await expectDecryptFailed(
          decryptField(
            keyA,
            { orgId: ORG_A, field: 'email' },
            flipByte(ct, () => i),
          ),
        );
      }),
      { numRuns: 60 },
    );
  });

  it('a ciphertext moved to another org fails (AAD binds the org)', async () => {
    await expectDecryptFailed(decryptField(keyA, { orgId: ORG_B, field: 'email' }, ct));
  });

  it('a ciphertext moved to another field fails (AAD binds the field)', async () => {
    await expectDecryptFailed(decryptField(keyA, { orgId: ORG_A, field: 'phone' }, ct));
    await expectDecryptFailed(decryptField(keyA, { orgId: ORG_A, field: 'full_name' }, ct));
  });

  it('a changed key version in the prefix fails (AAD binds the key version)', async () => {
    await expectDecryptFailed(
      decryptField(keyA, { orgId: ORG_A, field: 'email' }, ct.replace(/^v1\.1\./, 'v1.2.')),
    );
  });

  it('another key fails', async () => {
    await expectDecryptFailed(decryptField(keyB, { orgId: ORG_A, field: 'email' }, ct));
  });

  it.each([
    [''],
    ['v1'],
    ['v1.1.'],
    ['v2.1.AAAA'],
    ['v1.x.AAAA'],
    ['v1.1.AAAA'],
    ['v1.1.not base64'],
    ['v1.01.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    [`v1.1.${'A'.repeat(2050)}`],
  ])('a malformed value %j fails', async (bad) => {
    await expectDecryptFailed(decryptField(keyA, { orgId: ORG_A, field: 'email' }, bad));
  });

  it('a bad context or key also fails with decrypt_failed (never a value)', async () => {
    await expectDecryptFailed(decryptField(keyA, { orgId: 'x', field: 'email' }, ct));
    await expectDecryptFailed(decryptField(hmacKey, { orgId: ORG_A, field: 'email' }, ct));
  });
});

describe('ciphertextKeyVersion', () => {
  it('reads the version and refuses anything else with decrypt_failed', () => {
    expect(ciphertextKeyVersion('v1.12.AAAA')).toBe(12);
    for (const bad of ['', 'v1.0.AAAA', 'v1.x.AAAA', 'v2.1.AAAA', 'v1.1']) {
      let caught: unknown;
      try {
        ciphertextKeyVersion(bad);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(PiiCryptoError);
      expect((caught as PiiCryptoError).code).toBe('decrypt_failed');
    }
  });
});
