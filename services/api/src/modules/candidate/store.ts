// The candidate path's reads and writes as trace_api (spec §3.3 trace_api column, §3.4, §4.1). Each statement is
// constant text with bound parameters and names the org itself (`org_id = $1`) on top of RLS (`api_org_id()`).
// Status moves are conditional updates, so a lost race changes nothing; the invitations guard trigger is the
// database's own check of every move (L-1, L-12, L-17, L-31, L-32).
import type { ApiDb, SqlTx } from './api-db.js';

export type InvitationStatus =
  | 'created'
  | 'sent'
  | 'otp_verified'
  | 'started'
  | 'submitted'
  | 'expired'
  | 'revoked'
  | 'blocked_age';

export interface ResolvedInvitation {
  orgId: string;
  id: string;
  status: InvitationStatus;
  candidateId: string;
  sessionId: string | null;
  testVersionId: string;
  expiresAt: string;
}

export interface InvitationRow {
  id: string;
  orgId: string;
  status: InvitationStatus;
  candidateId: string;
  sessionId: string | null;
  startedAt: string | null;
  testVersionId: string;
  candidateLabel: string;
  contactEmail: string;
  adultConfirmedByInviter: boolean | null;
  adultSelfDeclared: boolean | null;
  expiresAt: string;
}

export interface TestVersionRow {
  id: string;
  status: 'draft' | 'published' | 'retired';
  totalTimeSeconds: number;
  rulesetVersionId: string | null;
  noticeVersionId: string | null;
  contentSha256: string | null;
}

export interface NoticeRow {
  id: string;
  bodyTemplate: string;
}

export interface ConsentRow {
  id: string;
}

export interface NewConsent {
  id: string;
  invitationId: string;
  testVersionId: string;
  rulesetVersionId: string;
  noticeVersionId: string;
  renderedSha256: string;
}

/** The statements available inside one trace_api transaction for one org. */
export interface OrgStore {
  invitation(id: string): Promise<InvitationRow | null>;
  testVersion(id: string): Promise<TestVersionRow | null>;
  /** The name of the version's test (the invite page title), or null when the org has no such version. */
  testTitle(testVersionId: string): Promise<string | null>;
  notice(id: string): Promise<NoticeRow | null>;
  consent(invitationId: string): Promise<ConsentRow | null>;
  insertConsent(row: NewConsent): Promise<void>;
  /** Moves the status to `to` if it is currently one of `from`; returns whether a row changed. */
  moveStatus(
    id: string,
    from: readonly InvitationStatus[],
    to: 'sent' | 'otp_verified',
  ): Promise<boolean>;
  /** Sets the set-once self-declared answer; returns the status after the guard ran, or null if already set. */
  declareAdult(id: string, adult: boolean): Promise<InvitationStatus | null>;
  /** Sets the set-once session id if none; returns whether a row changed. */
  setSessionId(id: string, sessionId: string): Promise<boolean>;
  /** otp_verified -> started with the DO's start time; returns the stored start time, or null if nothing moved. */
  markStarted(id: string, sessionId: string, startedAt: string): Promise<string | null>;
  /** Lazy expiry, only while no session id exists (L-32); returns whether a row changed. */
  markExpired(id: string): Promise<boolean>;
}

export interface CandidateStore {
  /** The cross-org token-hash lookup (org unset). */
  resolveByHash(hash: string): Promise<ResolvedInvitation | null>;
  withOrg<T>(orgId: string, fn: (store: OrgStore) => Promise<T>): Promise<T>;
}

// Timestamps leave Postgres as UTC ISO strings with milliseconds and `Z` (the candidate contracts' z.iso.datetime()).
const iso = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const SQL = {
  resolve: `select org_id, id, status::text as status, candidate_id, session_id, test_version_id, ${iso('expires_at')} as expires_at from private.resolve_invitation_by_hash($1)`,
  invitation: `select id, org_id, status::text as status, candidate_id, session_id, ${iso('started_at')} as started_at, test_version_id, candidate_label, contact_email, adult_confirmed_by_inviter, adult_self_declared, ${iso('expires_at')} as expires_at from public.invitations where org_id = $1 and id = $2`,
  testVersion:
    'select id, status::text as status, total_time_seconds, ruleset_version_id, notice_version_id, content_sha256 from public.test_versions where org_id = $1 and id = $2',
  // Fix round 1 #8: the invite page title is the test's name, never read from the package. trace_api holds no SELECT
  // on public.tests (D1 pin); migration M1-l's definer function returns the name, bound to private.api_org_id().
  testTitle: 'select private.api_test_title($1::uuid) as name',
  notice: 'select id, body_template from public.notice_versions where org_id = $1 and id = $2',
  consent:
    "select id from public.consents where org_id = $1 and invitation_id = $2 and event = 'granted'",
  insertConsent:
    "insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, rendered_sha256, language, event) values ($2, $1, $3, $4, $5, $6, $7, 'en', 'granted') on conflict (org_id, invitation_id, event) do nothing",
  moveStatus:
    'update public.invitations set status = $3::public.invitation_status where org_id = $1 and id = $2 and status::text = any ($4::text[]) returning id',
  declareAdult:
    'update public.invitations set adult_self_declared = $3::boolean where org_id = $1 and id = $2 and adult_self_declared is null returning status::text as status',
  setSessionId:
    'update public.invitations set session_id = $3::uuid where org_id = $1 and id = $2 and session_id is null returning id',
  markStarted: `update public.invitations set status = 'started', started_at = $4::timestamptz where org_id = $1 and id = $2 and session_id = $3::uuid and status = 'otp_verified' returning ${iso('started_at')} as started_at`,
  markExpired:
    "update public.invitations set status = 'expired' where org_id = $1 and id = $2 and session_id is null and status in ('created', 'sent', 'otp_verified') returning id",
} as const;

interface RawInvitation {
  id: string;
  org_id: string;
  status: InvitationStatus;
  candidate_id: string;
  session_id: string | null;
  started_at: string | null;
  test_version_id: string;
  candidate_label: string;
  contact_email: string;
  adult_confirmed_by_inviter: boolean | null;
  adult_self_declared: boolean | null;
  expires_at: string;
}

/** A text[] literal for ids and enum labels only (each matches [a-z_]+); never user text. */
const textArray = (values: readonly string[]): string => {
  for (const v of values) if (!/^[a-z_]{1,32}$/.test(v)) throw new Error('bad_array_value');
  return `{${values.join(',')}}`;
};

const orgStore = (tx: SqlTx, orgId: string): OrgStore => ({
  async invitation(id) {
    const [r] = await tx.query<RawInvitation>(SQL.invitation, [orgId, id]);
    if (r === undefined) return null;
    return {
      id: r.id,
      orgId: r.org_id,
      status: r.status,
      candidateId: r.candidate_id,
      sessionId: r.session_id,
      startedAt: r.started_at,
      testVersionId: r.test_version_id,
      candidateLabel: r.candidate_label,
      contactEmail: r.contact_email,
      adultConfirmedByInviter: r.adult_confirmed_by_inviter,
      adultSelfDeclared: r.adult_self_declared,
      expiresAt: r.expires_at,
    };
  },
  async testVersion(id) {
    const [r] = await tx.query<{
      id: string;
      status: TestVersionRow['status'];
      total_time_seconds: number;
      ruleset_version_id: string | null;
      notice_version_id: string | null;
      content_sha256: string | null;
    }>(SQL.testVersion, [orgId, id]);
    if (r === undefined) return null;
    return {
      id: r.id,
      status: r.status,
      totalTimeSeconds: Number(r.total_time_seconds),
      rulesetVersionId: r.ruleset_version_id,
      noticeVersionId: r.notice_version_id,
      contentSha256: r.content_sha256,
    };
  },
  async testTitle(testVersionId) {
    const [r] = await tx.query<{ name: string | null }>(SQL.testTitle, [testVersionId]);
    return r?.name ?? null;
  },
  async notice(id) {
    const [r] = await tx.query<{ id: string; body_template: string }>(SQL.notice, [orgId, id]);
    return r === undefined ? null : { id: r.id, bodyTemplate: r.body_template };
  },
  async consent(invitationId) {
    const [r] = await tx.query<{ id: string }>(SQL.consent, [orgId, invitationId]);
    return r === undefined ? null : { id: r.id };
  },
  async insertConsent(c) {
    await tx.query(SQL.insertConsent, [
      orgId,
      c.id,
      c.invitationId,
      c.testVersionId,
      c.rulesetVersionId,
      c.noticeVersionId,
      c.renderedSha256,
    ]);
  },
  async moveStatus(id, from, to) {
    const rows = await tx.query(SQL.moveStatus, [orgId, id, to, textArray(from)]);
    return rows.length === 1;
  },
  async declareAdult(id, adult) {
    const [r] = await tx.query<{ status: InvitationStatus }>(SQL.declareAdult, [orgId, id, adult]);
    return r === undefined ? null : r.status;
  },
  async setSessionId(id, sessionId) {
    const rows = await tx.query(SQL.setSessionId, [orgId, id, sessionId]);
    return rows.length === 1;
  },
  async markStarted(id, sessionId, startedAt) {
    const [r] = await tx.query<{ started_at: string }>(SQL.markStarted, [
      orgId,
      id,
      sessionId,
      startedAt,
    ]);
    return r === undefined ? null : r.started_at;
  },
  async markExpired(id) {
    const rows = await tx.query(SQL.markExpired, [orgId, id]);
    return rows.length === 1;
  },
});

export const createSqlCandidateStore = (db: ApiDb): CandidateStore => ({
  async resolveByHash(hash) {
    return db.withOrg(null, async (tx) => {
      const [r] = await tx.query<{
        org_id: string;
        id: string;
        status: InvitationStatus;
        candidate_id: string;
        session_id: string | null;
        test_version_id: string;
        expires_at: string;
      }>(SQL.resolve, [hash]);
      if (r === undefined) return null;
      return {
        orgId: r.org_id,
        id: r.id,
        status: r.status,
        candidateId: r.candidate_id,
        sessionId: r.session_id,
        testVersionId: r.test_version_id,
        expiresAt: r.expires_at,
      };
    });
  },
  withOrg: (orgId, fn) => db.withOrg(orgId, (tx) => fn(orgStore(tx, orgId))),
});
