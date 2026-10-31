// DevKeyManager (specs/m2-scheduling-invites.md M2-3, AT-M2-33): the KMS stand-in for dev and staging. It wraps each
// fresh 256-bit data key with AES-256-GCM under a wrapping key derived (HKDF-SHA-256) from a key-encryption key passed
// in as bytes (≥ 32; the wiring reads it from a Worker secret). The AAD binds org, purpose, the key reference and the
// key version, so a blob unwrapped for another org, purpose or key version fails, as KMS's EncryptionContext does
// (B1 fix 3). kms_key_ref is `dev:1`.
// Production refuses it (createKeyManager and this constructor, via assertDevKeyManagerEnv).
import {
  DATA_KEY_BYTES,
  KeyManagerError,
  assertKeyVersion,
  assertOrgAndPurpose,
  assertWrapped,
  base64ToBytes,
  bytesToBase64,
  importDataKey,
  keyVersionOf,
} from './key-manager.js';
import type { DataKey, DataKeyHandle, KeyManager, KeyPurpose } from './key-manager.js';

export const DEV_KEY_REF = 'dev:1';
export const DEV_KEK_MIN_BYTES = 32;

const DEV_KEY_MANAGER_ENVS: readonly string[] = ['dev', 'staging'];
const IV_BYTES = 12;
const HKDF_INFO = 'trace:dev-key-manager:wrap:v1';

/** Throws KeyManagerError('env_refused') unless `env` is exactly 'dev' or 'staging'. */
export function assertDevKeyManagerEnv(env: unknown): asserts env is 'dev' | 'staging' {
  if (typeof env !== 'string' || !DEV_KEY_MANAGER_ENVS.includes(env)) {
    throw new KeyManagerError('env_refused');
  }
}

const aad = (orgId: string, purpose: KeyPurpose, keyVersion: number): Uint8Array =>
  new TextEncoder().encode(
    `trace:dek:v1|org:${orgId}|purpose:${purpose}|ref:${DEV_KEY_REF}|kv:${keyVersion}`,
  );

export class DevKeyManager implements KeyManager {
  readonly #env: 'dev' | 'staging';
  readonly #kek: Uint8Array;
  #wrappingKey: Promise<DataKeyHandle> | null = null;

  constructor(traceEnv: unknown, options: { kek: Uint8Array }) {
    assertDevKeyManagerEnv(traceEnv);
    const kek = (options as { kek?: unknown } | undefined)?.kek;
    if (!(kek instanceof Uint8Array) || kek.length < DEV_KEK_MIN_BYTES) {
      throw new KeyManagerError('bad_options');
    }
    this.#env = traceEnv;
    this.#kek = Uint8Array.from(kek);
  }

  #wrapKey(): Promise<DataKeyHandle> {
    this.#wrappingKey ??= (async () => {
      const base = await crypto.subtle.importKey('raw', this.#kek, 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: new Uint8Array(32),
          info: new TextEncoder().encode(HKDF_INFO),
        },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    return this.#wrappingKey;
  }

  async generateDataKey(
    orgId: string,
    purpose: KeyPurpose,
    options?: { keyVersion?: number },
  ): Promise<DataKey> {
    assertDevKeyManagerEnv(this.#env);
    assertOrgAndPurpose(orgId, purpose);
    const keyVersion = keyVersionOf(options);
    const raw = crypto.getRandomValues(new Uint8Array(DATA_KEY_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad(orgId, purpose, keyVersion) },
        await this.#wrapKey(),
        raw,
      ),
    );
    const blob = new Uint8Array(IV_BYTES + sealed.length);
    blob.set(iv, 0);
    blob.set(sealed, IV_BYTES);
    const plaintext = await importDataKey(raw, purpose);
    return { plaintext, wrapped: bytesToBase64(blob), keyVersion, kmsKeyRef: DEV_KEY_REF };
  }

  async unwrap(
    orgId: string,
    purpose: KeyPurpose,
    wrapped: string,
    kmsKeyRef: string,
    keyVersion: number,
  ): Promise<DataKeyHandle> {
    assertDevKeyManagerEnv(this.#env);
    assertOrgAndPurpose(orgId, purpose);
    assertWrapped(wrapped);
    assertKeyVersion(keyVersion);
    if (kmsKeyRef !== DEV_KEY_REF) throw new KeyManagerError('bad_key_ref');
    const blob = base64ToBytes(wrapped);
    if (blob === null || blob.length !== IV_BYTES + DATA_KEY_BYTES + 16) {
      throw new KeyManagerError('unwrap_failed');
    }
    let raw: Uint8Array;
    try {
      raw = new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: blob.slice(0, IV_BYTES),
            additionalData: aad(orgId, purpose, keyVersion),
          },
          await this.#wrapKey(),
          blob.slice(IV_BYTES),
        ),
      );
    } catch {
      throw new KeyManagerError('unwrap_failed');
    }
    return importDataKey(raw, purpose);
  }
}

/** Decodes the dev key-encryption key from its base64 Worker secret; null when it is not ≥ 32 bytes of base64. */
export function devKekFromBase64(text: unknown): Uint8Array | null {
  if (typeof text !== 'string') return null;
  const bytes = base64ToBytes(text.trim());
  return bytes !== null && bytes.length >= DEV_KEK_MIN_BYTES ? bytes : null;
}
