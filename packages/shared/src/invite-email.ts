// member_invites.email_hmac (specs/m1-test-authoring.md R2-14, §3.2, R5-56 c): HMAC-SHA-256 of the normalised address
// (trimmed, lower case) keyed with the UTF-8 bytes of MEMBER_INVITE_PEPPER, as 64 lower-case hex. One definition for
// the api (writes the invite) and the jobs member provisioning (checks it). The address and the pepper never leave
// these functions in any form but the digest.

export const normaliseInviteEmail = (email: string): string => email.trim().toLowerCase();

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export const hmacSha256Hex = async (key: string, message: string): Promise<string> => {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
};

/** The constant error for a missing or empty pepper. */
export const PEPPER_EMPTY = 'member_invite_pepper_empty';

export const inviteEmailHmac = async (email: string, pepper: string): Promise<string> => {
  if (pepper.length === 0) throw new Error(PEPPER_EMPTY);
  return hmacSha256Hex(pepper, normaliseInviteEmail(email));
};

const HEX64 = /^[0-9a-f]{64}$/;

/** Constant-time equality of two 64-character lower-case hex digests; false for anything else. */
export const hexEqual = (a: string, b: string): boolean => {
  if (!HEX64.test(a) || !HEX64.test(b)) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
