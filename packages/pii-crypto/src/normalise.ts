// Normalisation and display hints (specs/m2-scheduling-invites.md M2-4, §3.2 candidate_contacts CHECKs, E23;
// build-notes 2026-10-31 "Wave 1 lead part" e). Not @trace/shared's normaliseInviteEmail: M2-4 adds NFKC (R5-36).
//
// Email: trim → NFKC → lower case; ASCII only; local part an RFC 5321 dot-atom (atext and dots, no leading,
// trailing or double dot, ≤ 64) containing at least one [a-z0-9]; domain of LDH labels (1–63, no leading or trailing
// hyphen, ≥ 2 labels, a TLD of letters); total ≤ 254; and the hint (first [a-z0-9] of the local part + •••@ + domain)
// ≤ 80 characters. Anything else is invalid_email.
// Phone: strip spaces, hyphens, dots and parentheses. With a leading +: E.164, 8–15 digits after the + (a country
// code never starts with 0), and +91 numbers need the national part ^[6-9][0-9]{9}$. Without +: an Indian mobile
// ^[6-9][0-9]{9}$, optionally after a leading 0 or 91, becomes +91…. Anything else is invalid_phone.
import { PiiInputError } from './errors.js';

/** The CHECK pattern of candidate_contacts.email_hint. */
export const EMAIL_HINT_RE = /^[a-z0-9]•••@[a-z0-9.-]+$/;
/** The CHECK pattern of candidate_contacts.phone_hint. */
export const PHONE_HINT_RE = /^••••[0-9]{4}$/;

export const EMAIL_MAX_LENGTH = 254;
export const EMAIL_LOCAL_MAX_LENGTH = 64;
export const EMAIL_HINT_MAX_LENGTH = 80;
/** A raw value longer than this is refused before any other work. */
const RAW_MAX_LENGTH = 512;

const ATEXT = "[a-z0-9!#$%&'*+/=?^_`{|}~-]";
const DOT_ATOM = new RegExp(`^${ATEXT}+(?:\\.${ATEXT}+)*$`);
const LDH_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^[a-z]{2,63}$/;
const ALNUM = /[a-z0-9]/;
const E164 = /^\+[1-9][0-9]{7,14}$/;
const INDIAN_MOBILE = /^[6-9][0-9]{9}$/;
const PHONE_SEPARATORS = /[\s().-]/g;

const invalidEmail = (): never => {
  throw new PiiInputError('invalid_email');
};
const invalidPhone = (): never => {
  throw new PiiInputError('invalid_phone');
};

/** Checks an already lower-case ASCII address; returns its hint or throws invalid_email. */
function checkedHint(email: string): string {
  if (email.length > EMAIL_MAX_LENGTH || !/^[\x21-\x7e]+$/.test(email)) return invalidEmail();
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return invalidEmail();
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > EMAIL_LOCAL_MAX_LENGTH || !DOT_ATOM.test(local)) return invalidEmail();
  const first = ALNUM.exec(local);
  if (first === null) return invalidEmail();
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((l) => LDH_LABEL.test(l))) return invalidEmail();
  if (!TLD.test(labels[labels.length - 1] as string)) return invalidEmail();
  const hint = `${first[0]}•••@${domain}`;
  if (hint.length > EMAIL_HINT_MAX_LENGTH || !EMAIL_HINT_RE.test(hint)) return invalidEmail();
  return hint;
}

/** M2-4 email normalisation; throws PiiInputError('invalid_email'). */
export function normaliseEmail(raw: string): string {
  if (typeof raw !== 'string' || raw.length > RAW_MAX_LENGTH) return invalidEmail();
  const email = raw.trim().normalize('NFKC').toLowerCase();
  checkedHint(email);
  return email;
}

/** The display hint of a normalised address (`a•••@example.test`); throws invalid_email for anything else. */
export function emailHint(normalisedEmail: string): string {
  if (typeof normalisedEmail !== 'string') return invalidEmail();
  return checkedHint(normalisedEmail);
}

/** M2-4 phone normalisation to E.164; throws PiiInputError('invalid_phone'). */
export function normalisePhone(raw: string): string {
  if (typeof raw !== 'string' || raw.length > 64) return invalidPhone();
  const compact = raw.replace(PHONE_SEPARATORS, '');
  if (compact.startsWith('+')) {
    if (!E164.test(compact)) return invalidPhone();
    if (compact.startsWith('+91') && !INDIAN_MOBILE.test(compact.slice(3))) return invalidPhone();
    return compact;
  }
  if (!/^[0-9]+$/.test(compact)) return invalidPhone();
  let national = compact;
  if (national.length === 11 && national.startsWith('0')) national = national.slice(1);
  else if (national.length === 12 && national.startsWith('91')) national = national.slice(2);
  if (!INDIAN_MOBILE.test(national)) return invalidPhone();
  return `+91${national}`;
}

/** `••••` plus the last four digits of an E.164 number; throws invalid_phone for anything else. */
export function phoneHint(e164: string): string {
  if (typeof e164 !== 'string' || !E164.test(e164)) return invalidPhone();
  return `••••${e164.slice(-4)}`;
}

/** Names are encrypted as given after NFC; the api validates them against the contract (InviteRow.fullName). */
export function normaliseName(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) throw new PiiInputError('invalid_name');
  return raw.normalize('NFC');
}
