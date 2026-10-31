// KeyManager (specs/m2-scheduling-invites.md M2-3, §3.2 org_keys, §5, §6.3, E18; build-notes 2026-10-31 "Wave 1 lead
// part" a, b): per-org data keys for contact encryption, wrapped by KMS (envelope encryption). Two purposes:
//   contacts  AES-GCM 256, encrypt + decrypt (the ciphertext columns)
//   bidx      HMAC SHA-256, sign (the blind indexes)
// Both come back as non-extractable CryptoKeys; @trace/pii-crypto takes them as parameters. The wrapped form is what
// org_keys.wrapped_dek stores (base64, ≤ 1 KB) next to kms_key_ref (the KMS key ARN, or `dev:<n>`).
// Implementations: AwsKmsKeyManager (key-manager-kms.ts), DevKeyManager (key-manager-dev.ts; dev and staging only),
// CachingKeyManager (key-manager-cache.ts). createKeyManager (key-manager-factory.ts) picks one.
// Errors carry codes only (KeyManagerError {code, retryable}); the api maps a retryable one to 503 crypto_unavailable
// with no plaintext fallback (E18, AT-M2-33).
import type { SigningKey } from '@trace/shared/invite-email';

export type KeyPurpose = 'contacts' | 'bidx';
export const KEY_PURPOSES: readonly KeyPurpose[] = ['contacts', 'bidx'];
/** WebCrypto's CryptoKey as the node, DOM and Workers typings all accept it. */
export type DataKeyHandle = SigningKey;

export interface DataKey {
  /** Non-extractable: contacts → AES-GCM 256 (encrypt, decrypt); bidx → HMAC SHA-256 (sign). */
  plaintext: DataKeyHandle;
  /** org_keys.wrapped_dek: base64, ≤ WRAPPED_KEY_MAX_LENGTH. */
  wrapped: string;
  /** org_keys.key_version. */
  keyVersion: number;
  /** org_keys.kms_key_ref: the KMS key ARN, or `dev:1`. */
  kmsKeyRef: string;
}

export interface KeyManager {
  /** A fresh data key for (org, purpose). `options.keyVersion` (default 1) is recorded, not interpreted. */
  generateDataKey(
    orgId: string,
    purpose: KeyPurpose,
    options?: { keyVersion?: number },
  ): Promise<DataKey>;
  /** The key a wrapped blob holds; fails (unwrap_failed) when it was wrapped for another org or purpose. */
  unwrap(
    orgId: string,
    purpose: KeyPurpose,
    wrapped: string,
    kmsKeyRef: string,
  ): Promise<DataKeyHandle>;
}

export const WRAPPED_KEY_MAX_LENGTH = 1024;
export const INITIAL_KEY_VERSION = 1;
export const DATA_KEY_BYTES = 32;

export type KeyManagerErrorCode =
  | 'bad_org'
  | 'bad_purpose'
  | 'bad_wrapped'
  | 'bad_key_ref'
  | 'bad_key_version'
  | 'bad_options'
  | 'env_refused'
  | 'provider_refused'
  | 'unknown_provider'
  | 'unwrap_failed'
  | 'kms_unavailable'
  | 'kms_throttled'
  | 'kms_rejected'
  | 'kms_bad_response';

const RETRYABLE: ReadonlySet<KeyManagerErrorCode> = new Set(['kms_unavailable', 'kms_throttled']);

/** Names the failed check only. `retryable`: KMS down or throttled (the api answers 503 crypto_unavailable). */
export class KeyManagerError extends Error {
  readonly code: KeyManagerErrorCode;
  readonly retryable: boolean;
  constructor(code: KeyManagerErrorCode) {
    super(`key manager: ${code}`);
    this.name = 'KeyManagerError';
    this.code = code;
    this.retryable = RETRYABLE.has(code);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function assertOrgAndPurpose(
  orgId: unknown,
  purpose: unknown,
): asserts purpose is KeyPurpose {
  if (typeof orgId !== 'string' || !UUID.test(orgId)) throw new KeyManagerError('bad_org');
  if (typeof purpose !== 'string' || !(KEY_PURPOSES as readonly string[]).includes(purpose)) {
    throw new KeyManagerError('bad_purpose');
  }
}

export function assertWrapped(wrapped: unknown): asserts wrapped is string {
  if (
    typeof wrapped !== 'string' ||
    wrapped.length === 0 ||
    wrapped.length > WRAPPED_KEY_MAX_LENGTH ||
    !BASE64.test(wrapped)
  ) {
    throw new KeyManagerError('bad_wrapped');
  }
}

export function keyVersionOf(options: { keyVersion?: number } | undefined): number {
  const v = options?.keyVersion ?? INITIAL_KEY_VERSION;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 2_147_483_647) {
    throw new KeyManagerError('bad_key_version');
  }
  return v;
}

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

/** Decodes canonical padded base64; null for anything else. */
export const base64ToBytes = (text: string): Uint8Array | null => {
  if (typeof text !== 'string' || !BASE64.test(text)) return null;
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

/**
 * Imports 32 raw bytes as the purpose's non-extractable key, then zeroes the bytes (the caller's copy is consumed).
 */
export async function importDataKey(raw: Uint8Array, purpose: KeyPurpose): Promise<DataKeyHandle> {
  try {
    if (raw.length !== DATA_KEY_BYTES) throw new KeyManagerError('kms_bad_response');
    return purpose === 'contacts'
      ? await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ])
      : await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
          'sign',
        ]);
  } finally {
    raw.fill(0);
  }
}
