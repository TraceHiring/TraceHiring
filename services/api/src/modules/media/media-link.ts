// The start-photo link (spec D1-5, §4.5, §6.2 "Media link" and R3-1..R3-9; rule 8: 5-minute signed link, viewer
// watermark, every view audited; R-15: viewing needs an assignment for every role).
//
// Issue: the caller is verified (org-context), the report and its start-photo media row are read AS THE CALLER and
// filtered by the path org (R3-8), then `private.media_link_grant` runs as trace_api in its own transaction (it checks
// membership, aal/amr, the workspace fence and the assignment, and writes `media.link_issued` naming the viewer).
// Only after that COMMIT is the jti stored in MediaLinkDO and the link returned (R3-2).
// Fetch: `sig` = HMAC-SHA-256 over `v1|jti|exp` is verified in constant time (`subtle.verify`) and `exp` is checked
// before anything else, the jti is burnt atomically in MediaLinkDO (a second fetch never reaches Postgres), then
// `private.media_view_grant` re-checks the viewer and writes `media.view`; only the key it returned, after COMMIT and a
// shape check, is streamed (R3-3). Every failure is the same 404 (R3-5). Nothing here logs a URL, jti, sig or key (R3-6).
import type { ApiDb } from '../candidate/api-db.js';
import { base64UrlDecode, base64UrlEncode, utf8 } from '../candidate/encoding.js';
import type { OrgCaller, Rest } from '../tests/org-context.js';
import type { LinkRecord } from './link-store.js';

export const LINK_TTL_SECONDS = 300;

/** The DO surface (one object per jti, one per viewer for the rate). */
export interface LinkClient {
  issue(jti: string, record: LinkRecord): Promise<void>;
  burn(jti: string, nowSec: number): Promise<LinkRecord | null>;
  allowIssue(viewerUserId: string, nowSec: number): Promise<boolean>;
}

/** The read side of the evidence bucket (R2 `get` only). */
export interface EvidenceReader {
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
}

export interface MediaDeps {
  db: ApiDb;
  links: LinkClient;
  evidence: EvidenceReader;
  hmacKey: CryptoKey;
  /** Epoch milliseconds. */
  now: () => number;
  newId: () => string;
}

const ROLE_ORDER = ['org_owner', 'admin', 'recruiter', 'reviewer', 'hiring_manager'] as const;
type OrgRole = (typeof ROLE_ORDER)[number];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SIG = /^[A-Za-z0-9_-]{43}$/;
const EXP = /^[0-9]{1,12}$/;

export const MEDIA_SQL = {
  linkGrant:
    'select private.media_link_grant($1::uuid, $2::uuid, $3::text, $4::text[], $5::uuid) as session_id',
  viewGrant:
    'select private.media_view_grant($1::uuid, $2::uuid, $3::text, $4::text[], $5::uuid) as r2_key',
} as const;

/** Imports MEDIA_LINK_HMAC_KEY (at least 32 characters) for HMAC-SHA-256 sign and verify. */
export const importHmacKey = async (secret: string): Promise<CryptoKey> => {
  if (secret.length < 32) throw new Error('hmac_key_invalid');
  return crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
};

/** The versioned, domain-separated signing input (R3-4). */
const signingInput = (jti: string, exp: number) => utf8(`v1|${jti}|${exp}`);

export const signLink = async (key: CryptoKey, jti: string, exp: number): Promise<string> =>
  base64UrlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, signingInput(jti, exp))));

/**
 * `amr` as a Postgres text[] literal, every method verbatim (R3-1): private.membership_counts maps the JWT's `amr` to
 * `e ->> 'method'` of each object element, and org-context keeps exactly the string methods in order. Each element is
 * double-quoted with `\` and `"` escaped, so no value is dropped, split or reinterpreted. (A non-string `method`,
 * which SQL would turn into its JSON text or NULL, is dropped by org-context; such a value can never equal `otp`,
 * `magiclink` or `password`, the only methods membership_counts_for reads, so the answer is the same.)
 */
export const amrLiteral = (amr: readonly string[]): string =>
  `{${amr.map((m) => `"${m.replace(/[\\"]/g, (ch) => `\\${ch}`)}"`).join(',')}}`;

export interface IssueInput {
  caller: OrgCaller;
  rest: Rest;
  orgId: string;
  reportId: string;
  /** The api origin the link points at (the request's own origin). */
  origin: string;
}

export interface IssuedLink {
  url: string;
  expiresAt: string;
  watermark: { viewerRole: OrgRole; org: string; issuedAt: string };
}

/** Throws `not_found` for every refusal (R3-5), `rate_limited` past the per-viewer limit (R3-7). */
export const issueStartPhotoLink = async (
  deps: MediaDeps,
  input: IssueInput,
): Promise<IssuedLink> => {
  const nowMs = deps.now();
  const nowSec = Math.floor(nowMs / 1000);
  const notFound = (): never => {
    throw new Error('not_found');
  };
  if (!(await deps.links.allowIssue(input.caller.userId, nowSec))) throw new Error('rate_limited');
  // R3-8: RLS alone returns rows of every org of a multi-org caller, so every read is filtered by the path org.
  const [report] = await input.rest.select<{ id: string; session_id: string }>('reports', {
    select: 'id,session_id',
    id: `eq.${input.reportId}`,
    org_id: `eq.${input.orgId}`,
  });
  if (report === undefined) return notFound();
  const [media] = await input.rest.select<{ id: string }>('media_objects', {
    select: 'id',
    org_id: `eq.${input.orgId}`,
    session_id: `eq.${report.session_id}`,
    kind: 'eq.start_photo',
  });
  if (media === undefined) return notFound();
  const [org] = await input.rest.select<{ name: string }>('orgs', {
    select: 'name',
    id: `eq.${input.orgId}`,
  });
  const [membership] = await input.rest.select<{ roles: string[] }>('memberships', {
    select: 'roles',
    org_id: `eq.${input.orgId}`,
    user_id: `eq.${input.caller.userId}`,
    status: 'eq.active',
  });
  const viewerRole = ROLE_ORDER.find((r) => membership?.roles.includes(r));
  if (org === undefined || viewerRole === undefined) return notFound();

  const jti = deps.newId();
  if (!UUID_V4.test(jti)) return notFound();
  const exp = nowSec + LINK_TTL_SECONDS;
  // R3-2: own transaction as trace_api with the path org; the grant writes media.link_issued; COMMIT before anything
  // is handed out. Any SQLSTATE is the same 404.
  try {
    await deps.db.withOrg(input.orgId, (tx) =>
      tx.query(MEDIA_SQL.linkGrant, [
        media.id,
        input.caller.userId,
        input.caller.aal,
        amrLiteral(input.caller.amr),
        jti,
      ]),
    );
  } catch {
    return notFound();
  }
  const record: LinkRecord = {
    mediaId: media.id,
    orgId: input.orgId,
    viewerUserId: input.caller.userId,
    aal: input.caller.aal,
    amr: [...input.caller.amr],
    exp,
  };
  try {
    await deps.links.issue(jti, record);
  } catch {
    return notFound();
  }
  const sig = await signLink(deps.hmacKey, jti, exp);
  return {
    url: `${input.origin}/media/${jti}?exp=${exp}&sig=${sig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
    watermark: { viewerRole, org: org.name, issuedAt: new Date(nowMs).toISOString() },
  };
};

export interface FetchInput {
  jti: string | undefined;
  exp: string | undefined;
  sig: string | undefined;
}

/** Returns the bytes, or null for every failure (the route answers the same 404). */
export const fetchStartPhoto = async (
  deps: MediaDeps,
  input: FetchInput,
): Promise<{ body: ReadableStream; size: number } | null> => {
  const { jti, exp: expText, sig } = input;
  if (jti === undefined || !UUID_V4.test(jti)) return null;
  if (expText === undefined || !EXP.test(expText) || sig === undefined || !SIG.test(sig))
    return null;
  const exp = Number(expText);
  const nowSec = Math.floor(deps.now() / 1000);
  // R3-4: refuse an expired link and one whose exp lies beyond the 300 s window, before any DO or DB call.
  if (exp < nowSec || exp > nowSec + LINK_TTL_SECONDS) return null;
  let signature: Uint8Array;
  try {
    signature = base64UrlDecode(sig);
  } catch {
    return null;
  }
  // Only the canonical encoding: 43 characters carry 258 bits for a 256-bit tag, so the last character's two low
  // bits are padding the decoder ignores; without this a link would have four valid `sig` spellings.
  if (base64UrlEncode(signature) !== sig) return null;
  if (!(await crypto.subtle.verify('HMAC', deps.hmacKey, signature, signingInput(jti, exp)))) {
    return null;
  }
  // Single use: the burn comes before the database, so a replay never reaches Postgres.
  let record: LinkRecord | null;
  try {
    record = await deps.links.burn(jti, nowSec);
  } catch {
    return null;
  }
  if (record === null || record.exp !== exp || record.exp < nowSec) return null;
  let key: string | undefined;
  try {
    const rows = await deps.db.withOrg(record.orgId, (tx) =>
      tx.query<{ r2_key: string }>(MEDIA_SQL.viewGrant, [
        record.mediaId,
        record.viewerUserId,
        record.aal,
        amrLiteral(record.amr),
        jti,
      ]),
    );
    key = rows[0]?.r2_key;
  } catch {
    return null;
  }
  // R3-3: stream only the key the database returned, and only one of the start-photo shape for this org.
  if (
    typeof key !== 'string' ||
    !key.startsWith(`media/${record.orgId}/`) ||
    !key.endsWith('/start_photo.jpg')
  ) {
    return null;
  }
  try {
    return await deps.evidence.get(key);
  } catch {
    return null;
  }
};
