// @trace/pii-crypto: contact and name encryption for M2 (specs/m2-scheduling-invites.md M2-3, M2-4, R5-36).
// Normalisation, AES-256-GCM envelope encryption with a per-org data key, per-org HMAC-SHA-256 blind indexes and
// display hints, all in services/api or workers/jobs memory: Postgres never sees plaintext. Keys arrive as
// CryptoKey parameters (KeyManager lives in @trace/vendors; this package imports only @trace/shared).

export type { BlindIndexKey } from './blind-index.js';
export {
  BLIND_INDEX_RE,
  blindIndexEqual,
  contactFingerprint,
  emailBlindIndex,
  phoneBlindIndex,
} from './blind-index.js';
export type { EncryptedField, FieldContext, FieldKey } from './cipher.js';
export {
  CIPHERTEXT_MAX_LENGTH,
  CIPHERTEXT_RE,
  CIPHERTEXT_VERSION,
  KEY_VERSION_MAX,
  PLAINTEXT_MAX_BYTES,
  ciphertextKeyVersion,
  decryptField,
  encryptField,
} from './cipher.js';
export type { ContactInput, ContactKeys, ProtectedContact } from './contact.js';
export { protectContact, revealContact } from './contact.js';
export type { PiiCryptoErrorCode, PiiInputErrorCode } from './errors.js';
export { PiiCryptoError, PiiInputError } from './errors.js';
export {
  EMAIL_HINT_MAX_LENGTH,
  EMAIL_HINT_RE,
  EMAIL_LOCAL_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PHONE_HINT_RE,
  emailHint,
  normaliseEmail,
  normaliseName,
  normalisePhone,
  phoneHint,
} from './normalise.js';
