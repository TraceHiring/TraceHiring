// The demo outbox as the recruiter reads it through the api (GET /v1/orgs/:orgId/demo-outbox, spec §6.2; D1-2):
// the invite body holds the candidate link (`<candidate origin>/i#<token>`), the OTP body the 6-digit code. The
// entries carry the candidate label, never an address. Nothing here prints a link, token or code.
import type { APIRequestContext } from '@playwright/test';
import { jsonOf, poll } from './http.js';

export interface OutboxEntry {
  id: string;
  createdAt: string;
  kind: 'invite' | 'otp';
  candidateLabel: string;
  bodyText: string;
}

const TOKEN = /\/i#([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/;
const CODE = /(?:^|\D)(\d{6})(?:\D|$)/;

/** The 43-character link token in an invite body, or null. */
export const linkTokenIn = (body: string): string | null => TOKEN.exec(body)?.[1] ?? null;
/** The 6-digit code in an OTP body, or null. */
export const otpCodeIn = (body: string): string | null => CODE.exec(body)?.[1] ?? null;
/** The token in the fragment of an invite URL, or null. */
export const linkTokenOfUrl = (url: string): string | null => {
  const hash = new URL(url).hash.slice(1);
  return /^[A-Za-z0-9_-]{43}$/.test(hash) ? hash : null;
};

export interface OutboxReader {
  /** Newest first (the DO lists by sequence, descending). */
  list(): Promise<OutboxEntry[]>;
  /** Waits for an OTP entry for `label` whose id is not in `seen`, and returns its code. */
  nextOtp(label: string, seen: ReadonlySet<string>): Promise<{ id: string; code: string }>;
}

export const outboxReader = (
  request: APIRequestContext,
  { api, orgId, jwt }: { api: string; orgId: string; jwt: string },
): OutboxReader => {
  const list = async () =>
    (
      await jsonOf<{ entries: OutboxEntry[] }>(
        await request.get(`${api}/v1/orgs/${orgId}/demo-outbox`, {
          headers: { Authorization: `Bearer ${jwt}` },
        }),
        200,
        'reading the demo outbox',
      )
    ).entries;
  return {
    list,
    nextOtp: (label, seen) =>
      poll('an OTP in the demo outbox', { timeoutMs: 15_000, everyMs: 500 }, async () => {
        const entry = (await list()).find(
          (e) => e.kind === 'otp' && e.candidateLabel === label && !seen.has(e.id),
        );
        if (entry === undefined) return undefined;
        const code = otpCodeIn(entry.bodyText);
        if (code === null) throw new Error('the OTP entry holds no 6-digit code');
        return { id: entry.id, code };
      }),
  };
};
