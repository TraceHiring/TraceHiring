// KeyManager (specs/m2-scheduling-invites.md M2-3, §3.2 org_keys, §5, §6.3; build-notes 2026-10-31 "Wave 1 lead
// part" a, b): DevKeyManager wraps per-org data keys with a key-encryption key bound to (org, purpose); keys come back
// as non-extractable CryptoKeys (contacts: AES-GCM 256, bidx: HMAC SHA-256); CachingKeyManager caches unwrapped keys
// for at most 300 s by an injected clock. Key material is generated per run. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { CachingKeyManager } from './key-manager-cache.js';
import { DevKeyManager } from './key-manager-dev.js';
import { KeyManagerError, WRAPPED_KEY_MAX_LENGTH } from './key-manager.js';
import type { DataKey, KeyManager, KeyPurpose } from './key-manager.js';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const ORG_B = '00000000-0000-4000-8000-0000000000b2';
const kek = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

const keyError = async (p: Promise<unknown>): Promise<KeyManagerError> => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(KeyManagerError);
  return e as KeyManagerError;
};

/** Proves a contacts key encrypts/decrypts and a bidx key signs, and that both are the same key after unwrap. */
const sameAes = async (a: DataKey['plaintext'], b: DataKey['plaintext']) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    a,
    new TextEncoder().encode('probe'),
  );
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, b, ct);
  expect(new TextDecoder().decode(pt)).toBe('probe');
};
const sameHmac = async (a: DataKey['plaintext'], b: DataKey['plaintext']) => {
  const msg = new TextEncoder().encode('probe');
  const sa = new Uint8Array(await crypto.subtle.sign('HMAC', a, msg));
  const sb = new Uint8Array(await crypto.subtle.sign('HMAC', b, msg));
  expect(sa).toEqual(sb);
};

describe('DevKeyManager', () => {
  it('generates a contacts key: AES-GCM 256, non-extractable, wrapped ≤ 1 KB, version 1, ref dev:1', async () => {
    const km = new DevKeyManager('dev', { kek: kek() });
    const dk = await km.generateDataKey(ORG_A, 'contacts');
    expect(dk.keyVersion).toBe(1);
    expect(dk.kmsKeyRef).toBe('dev:1');
    expect(dk.wrapped).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(dk.wrapped.length).toBeLessThanOrEqual(WRAPPED_KEY_MAX_LENGTH);
    expect(WRAPPED_KEY_MAX_LENGTH).toBe(1024);
    expect(dk.plaintext.extractable).toBe(false);
    expect(dk.plaintext.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect([...dk.plaintext.usages].sort()).toEqual(['decrypt', 'encrypt']);
    const unwrapped = await km.unwrap(ORG_A, 'contacts', dk.wrapped, dk.kmsKeyRef, 1);
    expect(unwrapped.extractable).toBe(false);
    await sameAes(dk.plaintext, unwrapped);
  });

  it('generates a bidx key: HMAC SHA-256 sign only, non-extractable', async () => {
    const km = new DevKeyManager('staging', { kek: kek() });
    const dk = await km.generateDataKey(ORG_A, 'bidx');
    expect(dk.plaintext.algorithm).toMatchObject({ name: 'HMAC', hash: { name: 'SHA-256' } });
    expect([...dk.plaintext.usages]).toEqual(['sign']);
    expect(dk.plaintext.extractable).toBe(false);
    await sameHmac(dk.plaintext, await km.unwrap(ORG_A, 'bidx', dk.wrapped, 'dev:1', 1));
  });

  it('generates a fresh key every time', async () => {
    const km = new DevKeyManager('dev', { kek: kek() });
    const a = await km.generateDataKey(ORG_A, 'contacts');
    const b = await km.generateDataKey(ORG_A, 'contacts');
    expect(a.wrapped).not.toBe(b.wrapped);
  });

  it('unwrap with the wrong org or purpose fails with unwrap_failed', async () => {
    const km = new DevKeyManager('dev', { kek: kek() });
    const dk = await km.generateDataKey(ORG_A, 'contacts');
    expect((await keyError(km.unwrap(ORG_B, 'contacts', dk.wrapped, 'dev:1', 1))).code).toBe(
      'unwrap_failed',
    );
    expect((await keyError(km.unwrap(ORG_A, 'bidx', dk.wrapped, 'dev:1', 1))).code).toBe(
      'unwrap_failed',
    );
  });

  it('unwrap with another key-encryption key or a tampered blob fails', async () => {
    const dk = await new DevKeyManager('dev', { kek: kek() }).generateDataKey(ORG_A, 'contacts');
    const other = new DevKeyManager('dev', { kek: kek() });
    expect((await keyError(other.unwrap(ORG_A, 'contacts', dk.wrapped, 'dev:1', 1))).code).toBe(
      'unwrap_failed',
    );
    const km = new DevKeyManager('dev', { kek: kek() });
    const dk2 = await km.generateDataKey(ORG_A, 'contacts');
    const flipped = (dk2.wrapped[5] === 'A' ? 'B' : 'A') as string;
    const tampered = dk2.wrapped.slice(0, 5) + flipped + dk2.wrapped.slice(6);
    expect((await keyError(km.unwrap(ORG_A, 'contacts', tampered, 'dev:1', 1))).code).toBe(
      'unwrap_failed',
    );
  });

  it('binds the key version into the wrap: a version 1 key does not unwrap as version 2 (B1 fix 3)', async () => {
    const km = new DevKeyManager('dev', { kek: kek() });
    const v1 = await km.generateDataKey(ORG_A, 'contacts');
    expect((await keyError(km.unwrap(ORG_A, 'contacts', v1.wrapped, 'dev:1', 2))).code).toBe(
      'unwrap_failed',
    );
    await sameAes(v1.plaintext, await km.unwrap(ORG_A, 'contacts', v1.wrapped, 'dev:1', 1));
    const v3 = await km.generateDataKey(ORG_A, 'bidx', { keyVersion: 3 });
    expect(v3.keyVersion).toBe(3);
    expect((await keyError(km.unwrap(ORG_A, 'bidx', v3.wrapped, 'dev:1', 1))).code).toBe(
      'unwrap_failed',
    );
    await sameHmac(v3.plaintext, await km.unwrap(ORG_A, 'bidx', v3.wrapped, 'dev:1', 3));
  });

  it.each([undefined, 0, -1, 1.5, '1', 2_147_483_648, Number.NaN])(
    'unwrap requires an explicit valid key version: %j is bad_key_version',
    async (bad) => {
      const km = new DevKeyManager('dev', { kek: kek() });
      const dk = await km.generateDataKey(ORG_A, 'contacts');
      expect(
        (await keyError(km.unwrap(ORG_A, 'contacts', dk.wrapped, 'dev:1', bad as never))).code,
      ).toBe('bad_key_version');
    },
  );

  it('validates its arguments with codes only', async () => {
    const km = new DevKeyManager('dev', { kek: kek() });
    expect((await keyError(km.generateDataKey('nope', 'contacts'))).code).toBe('bad_org');
    expect((await keyError(km.generateDataKey(ORG_A, 'secrets' as KeyPurpose))).code).toBe(
      'bad_purpose',
    );
    expect((await keyError(km.unwrap(ORG_A, 'contacts', '***', 'dev:1', 1))).code).toBe(
      'bad_wrapped',
    );
    expect((await keyError(km.unwrap(ORG_A, 'contacts', 'A'.repeat(1028), 'dev:1', 1))).code).toBe(
      'bad_wrapped',
    );
    expect((await keyError(km.unwrap(ORG_A, 'contacts', 'AAAA', 'dev:2', 1))).code).toBe(
      'bad_key_ref',
    );
    expect(
      (
        await keyError(
          km.unwrap(ORG_A, 'contacts', 'AAAA', 'arn:aws:kms:ap-south-1:000000000000:key/x', 1),
        )
      ).code,
    ).toBe('bad_key_ref');
  });

  it.each(['production', '', undefined, 'prod'])(
    'refuses traceEnv %j (dev and staging only)',
    (env) => {
      let caught: unknown;
      try {
        new DevKeyManager(env as never, { kek: kek() });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(KeyManagerError);
      expect((caught as KeyManagerError).code).toBe('env_refused');
    },
  );

  it('refuses a key-encryption key shorter than 32 bytes', () => {
    for (const bad of [
      new Uint8Array(31),
      new Uint8Array(0),
      'text' as never,
      undefined as never,
    ]) {
      let caught: unknown;
      try {
        new DevKeyManager('dev', { kek: bad });
      } catch (e) {
        caught = e;
      }
      expect((caught as KeyManagerError).code).toBe('bad_options');
    }
  });

  it('does not keep a reference to the caller’s key-encryption key bytes', async () => {
    const bytes = kek();
    const km = new DevKeyManager('dev', { kek: bytes });
    const dk = await km.generateDataKey(ORG_A, 'contacts');
    bytes.fill(0);
    await sameAes(dk.plaintext, await km.unwrap(ORG_A, 'contacts', dk.wrapped, 'dev:1', 1));
  });
});

describe('CachingKeyManager (≤ 300 s per (org, purpose, wrapped), injected clock; §6.3)', () => {
  class CountingKeyManager implements KeyManager {
    unwraps = 0;
    readonly inner = new DevKeyManager('dev', { kek: kek() });
    generateDataKey(orgId: string, purpose: KeyPurpose, options?: { keyVersion?: number }) {
      return this.inner.generateDataKey(orgId, purpose, options);
    }
    unwrap(orgId: string, purpose: KeyPurpose, wrapped: string, ref: string, version: number) {
      this.unwraps++;
      return this.inner.unwrap(orgId, purpose, wrapped, ref, version);
    }
  }

  it('keys the cache by key version: another version reaches the inner manager and fails (B1 fix 3)', async () => {
    const inner = new CountingKeyManager();
    const km = new CachingKeyManager(inner, { now: () => 0 });
    const dk = await inner.generateDataKey(ORG_A, 'contacts');
    await km.unwrap(ORG_A, 'contacts', dk.wrapped, dk.kmsKeyRef, 1);
    expect(inner.unwraps).toBe(1);
    expect((await keyError(km.unwrap(ORG_A, 'contacts', dk.wrapped, dk.kmsKeyRef, 2))).code).toBe(
      'unwrap_failed',
    );
    expect(inner.unwraps).toBe(2);
    const seeded = await km.generateDataKey(ORG_B, 'bidx', { keyVersion: 4 });
    expect(await km.unwrap(ORG_B, 'bidx', seeded.wrapped, seeded.kmsKeyRef, 4)).toBe(
      seeded.plaintext,
    );
    expect(inner.unwraps).toBe(2);
  });

  it('serves a repeat unwrap from the cache until the TTL passes', async () => {
    let now = 1_000_000;
    const inner = new CountingKeyManager();
    const km = new CachingKeyManager(inner, { now: () => now, ttlMs: 300_000 });
    const dk = await inner.generateDataKey(ORG_A, 'contacts');
    const k1 = await km.unwrap(ORG_A, 'contacts', dk.wrapped, dk.kmsKeyRef, 1);
    const k2 = await km.unwrap(ORG_A, 'contacts', dk.wrapped, dk.kmsKeyRef, 1);
    expect(k2).toBe(k1);
    expect(inner.unwraps).toBe(1);
    now += 299_999;
    await km.unwrap(ORG_A, 'contacts', dk.wrapped, dk.kmsKeyRef, 1);
    expect(inner.unwraps).toBe(1);
    now += 2;
    await km.unwrap(ORG_A, 'contacts', dk.wrapped, dk.kmsKeyRef, 1);
    expect(inner.unwraps).toBe(2);
  });

  it('keys the cache by org and purpose: a wrong org still goes to the inner manager and fails', async () => {
    const inner = new CountingKeyManager();
    const km = new CachingKeyManager(inner, { now: () => 0 });
    const dk = await inner.generateDataKey(ORG_A, 'contacts');
    await km.unwrap(ORG_A, 'contacts', dk.wrapped, dk.kmsKeyRef, 1);
    expect((await keyError(km.unwrap(ORG_B, 'contacts', dk.wrapped, dk.kmsKeyRef, 1))).code).toBe(
      'unwrap_failed',
    );
    expect((await keyError(km.unwrap(ORG_A, 'bidx', dk.wrapped, dk.kmsKeyRef, 1))).code).toBe(
      'unwrap_failed',
    );
    expect(inner.unwraps).toBe(3);
  });

  it('seeds the cache from generateDataKey and never caches a failure', async () => {
    const inner = new CountingKeyManager();
    const km = new CachingKeyManager(inner, { now: () => 0 });
    const dk = await km.generateDataKey(ORG_A, 'bidx');
    expect(await km.unwrap(ORG_A, 'bidx', dk.wrapped, dk.kmsKeyRef, 1)).toBe(dk.plaintext);
    expect(inner.unwraps).toBe(0);
    await keyError(km.unwrap(ORG_B, 'bidx', dk.wrapped, dk.kmsKeyRef, 1));
    await keyError(km.unwrap(ORG_B, 'bidx', dk.wrapped, dk.kmsKeyRef, 1));
    expect(inner.unwraps).toBe(2);
  });

  it('sweeps expired entries by time on every put and unwrap, before the size check (§9; B1 fix 6)', async () => {
    let now = 0;
    const inner = new CountingKeyManager();
    const km = new CachingKeyManager(inner, { now: () => now, ttlMs: 1_000, maxEntries: 100 });
    const a = await inner.generateDataKey(ORG_A, 'contacts');
    const b = await inner.generateDataKey(ORG_A, 'bidx');
    await km.unwrap(ORG_A, 'contacts', a.wrapped, a.kmsKeyRef, 1);
    now = 500;
    await km.unwrap(ORG_A, 'bidx', b.wrapped, b.kmsKeyRef, 1);
    expect(km.cachedKeyCountForTests()).toBe(2);
    // A lookup of another key (a cache hit) still drops the expired entry for A.
    now = 1_000;
    await km.unwrap(ORG_A, 'bidx', b.wrapped, b.kmsKeyRef, 1);
    expect(inner.unwraps).toBe(2);
    expect(km.cachedKeyCountForTests()).toBe(1);
    // A put (generateDataKey) sweeps too: B expired at 1 500.
    now = 1_500;
    await km.generateDataKey(ORG_B, 'contacts');
    expect(km.cachedKeyCountForTests()).toBe(1);
    // A failed unwrap still sweeps.
    now = 2_500;
    await keyError(km.unwrap(ORG_B, 'bidx', a.wrapped, a.kmsKeyRef, 1));
    expect(km.cachedKeyCountForTests()).toBe(0);
  });

  it('a full cache drops every expired entry, not only the one the size check needs', async () => {
    let now = 0;
    const inner = new CountingKeyManager();
    const km = new CachingKeyManager(inner, { now: () => now, ttlMs: 1_000, maxEntries: 3 });
    const a = await inner.generateDataKey(ORG_A, 'contacts');
    const b = await inner.generateDataKey(ORG_A, 'bidx');
    const c = await inner.generateDataKey(ORG_B, 'contacts');
    const d = await inner.generateDataKey(ORG_B, 'bidx');
    await km.unwrap(ORG_A, 'contacts', a.wrapped, a.kmsKeyRef, 1);
    now = 100;
    await km.unwrap(ORG_A, 'bidx', b.wrapped, b.kmsKeyRef, 1);
    now = 900;
    await km.unwrap(ORG_B, 'contacts', c.wrapped, c.kmsKeyRef, 1);
    expect(km.cachedKeyCountForTests()).toBe(3);
    now = 1_100; // A and B expired; C live
    await km.unwrap(ORG_B, 'bidx', d.wrapped, d.kmsKeyRef, 1);
    expect(km.cachedKeyCountForTests()).toBe(2); // C and D
    await km.unwrap(ORG_B, 'contacts', c.wrapped, c.kmsKeyRef, 1);
    expect(inner.unwraps).toBe(4); // C was kept
  });

  it('evicts the oldest entry past maxEntries', async () => {
    const inner = new CountingKeyManager();
    const km = new CachingKeyManager(inner, { now: () => 0, maxEntries: 2 });
    const a = await inner.generateDataKey(ORG_A, 'contacts');
    const b = await inner.generateDataKey(ORG_A, 'bidx');
    const c = await inner.generateDataKey(ORG_B, 'contacts');
    await km.unwrap(ORG_A, 'contacts', a.wrapped, a.kmsKeyRef, 1);
    await km.unwrap(ORG_A, 'bidx', b.wrapped, b.kmsKeyRef, 1);
    await km.unwrap(ORG_B, 'contacts', c.wrapped, c.kmsKeyRef, 1);
    expect(inner.unwraps).toBe(3);
    await km.unwrap(ORG_A, 'contacts', a.wrapped, a.kmsKeyRef, 1); // evicted: goes to the inner manager again
    expect(inner.unwraps).toBe(4);
  });

  it('refuses a TTL over 300 s, a non-positive one and a missing clock', () => {
    const inner = new CountingKeyManager();
    for (const opts of [
      { now: () => 0, ttlMs: 300_001 },
      { now: () => 0, ttlMs: 0 },
      { now: undefined as never },
    ]) {
      let caught: unknown;
      try {
        new CachingKeyManager(inner, opts);
      } catch (e) {
        caught = e;
      }
      expect((caught as KeyManagerError).code).toBe('bad_options');
    }
  });
});
