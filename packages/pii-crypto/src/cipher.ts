// AES-256-GCM field encryption with the per-org data key (specs/m2-scheduling-invites.md M2-3, §3.2 ciphertext
// CHECKs; build-notes 2026-10-31 "Wave 1 lead part" b). Format `v1.<keyVersion>.<base64url(iv12 ‖ ciphertext+tag)>`,
// a fresh random 96-bit IV per value, ≤ 2,048 characters. The additional authenticated data binds the org, the field
// and the key version, so a ciphertext moved to another org, another field or another version fails to decrypt.
// The key arrives as a CryptoKey parameter (KeyManager in @trace/vendors unwraps it); this file never sees key bytes.
// Every decryption failure is the one constant code `decrypt_failed`.
import { PiiCryptoError } from './errors.js';

/** WebCrypto's key type as `crypto.subtle.encrypt` takes it (the same under node, DOM and Workers typings). */
export type FieldKey = Parameters<typeof crypto.subtle.encrypt>[1];

export const CIPHERTEXT_VERSION = 'v1';
/** The CHECK pattern of every `*_ct` column (candidates.full_name_ct, candidate_contacts.email_ct, phone_ct). */
export const CIPHERTEXT_RE = /^v1\.[0-9]+\.[A-Za-z0-9_-]+$/;
export const CIPHERTEXT_MAX_LENGTH = 2048;
/** The longest plaintext accepted, in UTF-8 bytes (keeps every ciphertext under CIPHERTEXT_MAX_LENGTH). */
export const PLAINTEXT_MAX_BYTES = 1024;
export const KEY_VERSION_MAX = 2_147_483_647;

export type EncryptedField = 'email' | 'phone' | 'full_name';
export interface FieldContext {
  orgId: string;
  field: EncryptedField;
  keyVersion: number;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;
const FIELDS: readonly string[] = ['email', 'phone', 'full_name'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PARSE = /^v1\.([1-9][0-9]{0,9})\.([A-Za-z0-9_-]+)$/;

const validContext = (orgId: unknown, field: unknown, keyVersion: unknown): boolean =>
  typeof orgId === 'string' &&
  UUID.test(orgId) &&
  typeof field === 'string' &&
  FIELDS.includes(field) &&
  typeof keyVersion === 'number' &&
  Number.isInteger(keyVersion) &&
  keyVersion >= 1 &&
  keyVersion <= KEY_VERSION_MAX;

const aad = (orgId: string, field: string, keyVersion: number): Uint8Array =>
  new TextEncoder().encode(`trace:v1|org:${orgId}|field:${field}|kv:${keyVersion}`);

const isAesGcm256 = (key: FieldKey, usage: 'encrypt' | 'decrypt'): boolean => {
  const algorithm = key.algorithm as { name?: string; length?: number };
  return (
    key.type === 'secret' &&
    algorithm.name === 'AES-GCM' &&
    algorithm.length === 256 &&
    key.usages.includes(usage)
  );
};

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes unpadded base64url; null for anything that is not canonical base64url. */
export function base64UrlDecode(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  // Canonical only: re-encoding gives the same text (no stray trailing bits).
  return base64UrlEncode(bytes) === text ? bytes : null;
}

/** Encrypts one field value. Throws PiiCryptoError (bad_context, key_invalid, plaintext_invalid, encrypt_failed). */
export async function encryptField(
  key: FieldKey,
  ctx: FieldContext,
  plaintext: string,
): Promise<string> {
  const { orgId, field, keyVersion } = ctx;
  if (!validContext(orgId, field, keyVersion)) throw new PiiCryptoError('bad_context');
  if (!isAesGcm256(key, 'encrypt')) throw new PiiCryptoError('key_invalid');
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new PiiCryptoError('plaintext_invalid');
  }
  const data = new TextEncoder().encode(plaintext);
  if (data.length > PLAINTEXT_MAX_BYTES) throw new PiiCryptoError('plaintext_invalid');
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  let sealed: ArrayBuffer;
  try {
    sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad(orgId, field, keyVersion), tagLength: 128 },
      key,
      data,
    );
  } catch {
    throw new PiiCryptoError('encrypt_failed');
  }
  const payload = new Uint8Array(IV_BYTES + sealed.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(sealed), IV_BYTES);
  const out = `${CIPHERTEXT_VERSION}.${keyVersion}.${base64UrlEncode(payload)}`;
  if (out.length > CIPHERTEXT_MAX_LENGTH || !CIPHERTEXT_RE.test(out)) {
    throw new PiiCryptoError('encrypt_failed');
  }
  return out;
}

/** The key version a ciphertext was written with (to pick the org key); throws decrypt_failed for a bad shape. */
export function ciphertextKeyVersion(ciphertext: string): number {
  const m = typeof ciphertext === 'string' ? PARSE.exec(ciphertext) : null;
  const kv = m === null ? NaN : Number(m[1]);
  if (!Number.isInteger(kv) || kv < 1 || kv > KEY_VERSION_MAX) {
    throw new PiiCryptoError('decrypt_failed');
  }
  return kv;
}

/**
 * Decrypts one field value written for (orgId, field). The key version comes from the ciphertext and is bound by
 * the AAD. Every failure throws PiiCryptoError('decrypt_failed').
 */
export async function decryptField(
  key: FieldKey,
  ctx: { orgId: string; field: EncryptedField },
  ciphertext: string,
): Promise<string> {
  try {
    if (typeof ciphertext !== 'string' || ciphertext.length > CIPHERTEXT_MAX_LENGTH)
      throw new Error();
    const m = PARSE.exec(ciphertext);
    if (m === null) throw new Error();
    const keyVersion = Number(m[1]);
    const { orgId, field } = ctx;
    if (!validContext(orgId, field, keyVersion) || !isAesGcm256(key, 'decrypt')) throw new Error();
    const payload = base64UrlDecode(m[2] as string);
    if (payload === null || payload.length < IV_BYTES + TAG_BYTES + 1) throw new Error();
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: payload.slice(0, IV_BYTES),
        additionalData: aad(orgId, field, keyVersion),
        tagLength: 128,
      },
      key,
      payload.slice(IV_BYTES),
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch {
    throw new PiiCryptoError('decrypt_failed');
  }
}
