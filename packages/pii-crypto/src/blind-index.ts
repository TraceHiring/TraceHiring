// Per-org HMAC-SHA-256 blind indexes (specs/m2-scheduling-invites.md M2-3, M2-5, E4, §3.2; build-notes 2026-10-31
// "Wave 1 lead part" a, b). The org's bidx key arrives as an HMAC SHA-256 CryptoKey; the digest is @trace/shared's
// hmacSha256HexKey with domain separation, so an email index, a phone index and a contact fingerprint of the same
// text never collide:
//   email_bidx          = HMAC(bidxKey, "email:" + normalisedEmail)
//   phone_bidx          = HMAC(bidxKey, "phone:" + e164)
//   contact_fingerprint = HMAC(bidxKey, "candidate:" + normalisedEmail)
// All are 64 lower-case hex. Values must already be normalised (normaliseEmail / normalisePhone); anything else is
// refused, so a caller cannot index an unnormalised value by mistake. Compare digests with blindIndexEqual.
import { hexEqual, hmacSha256HexKey } from '@trace/shared/invite-email';
import type { SigningKey } from '@trace/shared/invite-email';
import { PiiCryptoError, PiiInputError } from './errors.js';
import { normaliseEmail, normalisePhone } from './normalise.js';

export type BlindIndexKey = SigningKey;

/** The CHECK pattern of email_bidx, phone_bidx and contact_fingerprint. */
export const BLIND_INDEX_RE = /^[0-9a-f]{64}$/;

const isNormalised = (value: string, normalise: (v: string) => string): boolean => {
  try {
    return typeof value === 'string' && normalise(value) === value;
  } catch (e) {
    if (e instanceof PiiInputError) return false;
    throw e;
  }
};

async function digest(key: BlindIndexKey, message: string): Promise<string> {
  try {
    return await hmacSha256HexKey(key, message);
  } catch {
    // hmacSha256HexKey throws SIGNING_KEY_INVALID for a key that is not HMAC SHA-256 with `sign`.
    throw new PiiCryptoError('key_invalid');
  }
}

/** email_bidx of a normalised address. */
export async function emailBlindIndex(
  bidxKey: BlindIndexKey,
  normalisedEmail: string,
): Promise<string> {
  if (!isNormalised(normalisedEmail, normaliseEmail)) throw new PiiCryptoError('bad_context');
  return digest(bidxKey, `email:${normalisedEmail}`);
}

/** phone_bidx of an E.164 number from normalisePhone. */
export async function phoneBlindIndex(bidxKey: BlindIndexKey, e164: string): Promise<string> {
  if (!isNormalised(e164, normalisePhone)) throw new PiiCryptoError('bad_context');
  return digest(bidxKey, `phone:${e164}`);
}

/** candidates.contact_fingerprint of a normalised address (one candidate row per person per workspace, R2-2). */
export async function contactFingerprint(
  bidxKey: BlindIndexKey,
  normalisedEmail: string,
): Promise<string> {
  if (!isNormalised(normalisedEmail, normaliseEmail)) throw new PiiCryptoError('bad_context');
  return digest(bidxKey, `candidate:${normalisedEmail}`);
}

/** Constant-time equality of two blind indexes; false unless both are 64 lower-case hex. */
export const blindIndexEqual = (a: string, b: string): boolean => hexEqual(a, b);
