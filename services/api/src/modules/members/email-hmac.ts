// member_invites.email_hmac (spec m1 R2-14, M1-20): HMAC-SHA-256 keyed with the UTF-8 bytes of MEMBER_INVITE_PEPPER
// over the UTF-8 bytes of the normalised address (trim, then lower-case), as lower-case hex. workers/jobs
// (`workers/jobs/src/members/email-hmac.ts`, stream A3b) checks the queue message's address against the invite row
// with the same function; the lead moves both copies into @trace/shared at merge. The pepper and the address are never
// logged or returned.
const encoder = new TextEncoder();

/** The normalised address the HMAC is computed over (and the queue message carries). */
export const normaliseInviteEmail = (email: string): string => email.trim().toLowerCase();

export const inviteEmailHmac = async (pepper: string, email: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(normaliseInviteEmail(email)));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
};
