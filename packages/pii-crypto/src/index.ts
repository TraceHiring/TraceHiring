// @trace/pii-crypto: contact and name encryption for M2 (specs/m2-scheduling-invites.md M2-3, M2-4, R5-36).
// Normalisation, AES-256-GCM envelope encryption with a per-org data key, per-org HMAC-SHA-256 blind indexes and
// display hints, all in services/api or workers/jobs memory: Postgres never sees plaintext. Keys arrive as
// CryptoKey parameters (KeyManager lives in @trace/vendors; this package imports only @trace/shared). Stream B1
// fills this skeleton (lead, Wave 1).

/** The ciphertext format version (`v1.<keyVersion>.<base64url>`, the CHECK shape of migrations M2-a and M2-b). */
export const CIPHERTEXT_VERSION = 'v1';
