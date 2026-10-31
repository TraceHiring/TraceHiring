// One invite row's contact columns (specs/m2-scheduling-invites.md §6.2 "normalise → encrypt name/email/phone with
// the org DEK, compute blind indexes and hints", §3.2 candidates + candidate_contacts), and the inverse the messaging
// consumer needs (§6.3 "decrypt recipient and first name in memory"). Plaintext exists only inside these calls.
import { contactFingerprint, emailBlindIndex, phoneBlindIndex } from './blind-index.js';
import type { BlindIndexKey } from './blind-index.js';
import { decryptField, encryptField } from './cipher.js';
import type { FieldKey } from './cipher.js';
import {
  emailHint,
  normaliseEmail,
  normaliseName,
  normalisePhone,
  phoneHint,
} from './normalise.js';

export interface ContactKeys {
  /** The org's `contacts` data key (AES-GCM 256, encrypt + decrypt). */
  contactsKey: FieldKey;
  /** The org's `bidx` key (HMAC SHA-256, sign). */
  bidxKey: BlindIndexKey;
  /** org_keys.key_version of the contacts key (recorded in every ciphertext). */
  keyVersion: number;
}

export interface ContactInput {
  orgId: string;
  fullName: string;
  email: string;
  phone?: string | null | undefined;
}

/** The columns of candidates + candidate_contacts for one row; no plaintext. */
export interface ProtectedContact {
  keyVersion: number;
  fullNameCt: string;
  emailCt: string;
  phoneCt: string | null;
  emailBidx: string;
  phoneBidx: string | null;
  emailHint: string;
  phoneHint: string | null;
  contactFingerprint: string;
}

/**
 * Normalises (M2-4), encrypts and indexes one row. Throws PiiInputError (invalid_email, invalid_phone, invalid_name)
 * for a value the row must be rejected for, and PiiCryptoError for a key or context problem.
 */
export async function protectContact(
  keys: ContactKeys,
  input: ContactInput,
): Promise<ProtectedContact> {
  const email = normaliseEmail(input.email);
  const phone =
    input.phone === undefined || input.phone === null || input.phone === ''
      ? null
      : normalisePhone(input.phone);
  const fullName = normaliseName(input.fullName);
  const ctx = { orgId: input.orgId, keyVersion: keys.keyVersion };
  const [fullNameCt, emailCt, phoneCt, emailBidx, phoneBidx, fingerprint] = await Promise.all([
    encryptField(keys.contactsKey, { ...ctx, field: 'full_name' }, fullName),
    encryptField(keys.contactsKey, { ...ctx, field: 'email' }, email),
    phone === null
      ? Promise.resolve(null)
      : encryptField(keys.contactsKey, { ...ctx, field: 'phone' }, phone),
    emailBlindIndex(keys.bidxKey, email),
    phone === null ? Promise.resolve(null) : phoneBlindIndex(keys.bidxKey, phone),
    contactFingerprint(keys.bidxKey, email),
  ]);
  return {
    keyVersion: keys.keyVersion,
    fullNameCt,
    emailCt,
    phoneCt,
    emailBidx,
    phoneBidx,
    emailHint: emailHint(email),
    phoneHint: phone === null ? null : phoneHint(phone),
    contactFingerprint: fingerprint,
  };
}

/** Decrypts a stored row's ciphertexts (each with the contacts key of its own key version). */
export async function revealContact(
  contactsKey: FieldKey,
  orgId: string,
  row: { fullNameCt: string; emailCt: string; phoneCt: string | null },
): Promise<{ fullName: string; email: string; phone: string | null }> {
  const [fullName, email, phone] = await Promise.all([
    decryptField(contactsKey, { orgId, field: 'full_name' }, row.fullNameCt),
    decryptField(contactsKey, { orgId, field: 'email' }, row.emailCt),
    row.phoneCt === null
      ? Promise.resolve(null)
      : decryptField(contactsKey, { orgId, field: 'phone' }, row.phoneCt),
  ]);
  return { fullName, email, phone };
}
