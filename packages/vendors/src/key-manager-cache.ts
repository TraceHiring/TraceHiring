// CachingKeyManager (specs/m2-scheduling-invites.md §6.3 "unwrap DEK (cache ≤ 5 min per isolate)", §9 DEK cache
// lifetime): caches unwrapped keys per (org, purpose, wrapped blob, key reference, key version) for at most 300 s by
// an injected clock, bounded in size (oldest first out). Only non-extractable CryptoKeys are cached; a failure is never
// cached, and a wrong org, purpose or key version is a different cache key, so it still reaches the inner manager and
// fails there.
import { KeyManagerError } from './key-manager.js';
import type { DataKey, DataKeyHandle, KeyManager, KeyPurpose } from './key-manager.js';

export const KEY_CACHE_MAX_TTL_MS = 300_000;
export const KEY_CACHE_DEFAULT_MAX_ENTRIES = 1000;

export interface CachingKeyManagerOptions {
  /** Epoch milliseconds (injected; a Worker passes Date.now). */
  now: () => number;
  /** ≤ 300 000 (the default). */
  ttlMs?: number;
  maxEntries?: number;
}

export class CachingKeyManager implements KeyManager {
  readonly #inner: KeyManager;
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #entries = new Map<string, { key: DataKeyHandle; expiresAt: number }>();

  constructor(inner: KeyManager, options: CachingKeyManagerOptions) {
    if (
      typeof inner !== 'object' ||
      inner === null ||
      typeof inner.generateDataKey !== 'function' ||
      typeof inner.unwrap !== 'function'
    ) {
      throw new KeyManagerError('bad_options');
    }
    const {
      now,
      ttlMs = KEY_CACHE_MAX_TTL_MS,
      maxEntries = KEY_CACHE_DEFAULT_MAX_ENTRIES,
    } = options ?? {};
    if (typeof now !== 'function') throw new KeyManagerError('bad_options');
    if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > KEY_CACHE_MAX_TTL_MS) {
      throw new KeyManagerError('bad_options');
    }
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 100_000) {
      throw new KeyManagerError('bad_options');
    }
    this.#inner = inner;
    this.#now = now;
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
  }

  #put(cacheKey: string, key: DataKeyHandle): void {
    this.#entries.delete(cacheKey);
    while (this.#entries.size >= this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
    this.#entries.set(cacheKey, { key, expiresAt: this.#now() + this.#ttlMs });
  }

  async generateDataKey(
    orgId: string,
    purpose: KeyPurpose,
    options?: { keyVersion?: number },
  ): Promise<DataKey> {
    const dk = await this.#inner.generateDataKey(orgId, purpose, options);
    this.#put(
      JSON.stringify([orgId, purpose, dk.wrapped, dk.kmsKeyRef, dk.keyVersion]),
      dk.plaintext,
    );
    return dk;
  }

  async unwrap(
    orgId: string,
    purpose: KeyPurpose,
    wrapped: string,
    kmsKeyRef: string,
    keyVersion: number,
  ): Promise<DataKeyHandle> {
    const cacheKey = JSON.stringify([orgId, purpose, wrapped, kmsKeyRef, keyVersion]);
    const hit = this.#entries.get(cacheKey);
    if (hit !== undefined) {
      if (this.#now() < hit.expiresAt) return hit.key;
      this.#entries.delete(cacheKey);
    }
    const key = await this.#inner.unwrap(orgId, purpose, wrapped, kmsKeyRef, keyVersion);
    this.#put(cacheKey, key);
    return key;
  }
}
