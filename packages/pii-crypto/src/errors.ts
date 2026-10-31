// Typed errors of @trace/pii-crypto. Each carries a code only: never a value, a key or a ciphertext (CLAUDE.md "No
// PII in logs, errors"; specs/m2-scheduling-invites.md §6.3 "errors carry codes only").

/** A row value the api must reject (an invite row reason; §6.2). */
export type PiiInputErrorCode = 'invalid_email' | 'invalid_phone' | 'invalid_name';

export class PiiInputError extends Error {
  readonly code: PiiInputErrorCode;
  constructor(code: PiiInputErrorCode) {
    super(`pii-crypto: ${code}`);
    this.name = 'PiiInputError';
    this.code = code;
  }
}

/**
 * A crypto failure. `decrypt_failed` is the one constant code for every decryption failure (bad shape, wrong key,
 * wrong org or field, tampering), so a caller learns nothing about why.
 */
export type PiiCryptoErrorCode =
  'decrypt_failed' | 'key_invalid' | 'bad_context' | 'plaintext_invalid' | 'encrypt_failed';

export class PiiCryptoError extends Error {
  readonly code: PiiCryptoErrorCode;
  constructor(code: PiiCryptoErrorCode) {
    super(`pii-crypto: ${code}`);
    this.name = 'PiiCryptoError';
    this.code = code;
  }
}
