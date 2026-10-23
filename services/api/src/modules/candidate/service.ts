// The CandidateRpc logic (spec §4.1 step order and invitation states, §4.2 methods, §4.3 tokens, §10-DB). Inputs
// arrive already zod-parsed by the entrypoint. Every method after lobbyMint re-verifies the raw lobby token here
// (signature, typ, lifetime, exp, iat), then reads the invitation the claims name and checks that its candidate is
// the token's. Ids come from verified claims or from the edge's claim-derived arguments, never from candidate input.
// All database work goes through CandidateStore, i.e. as trace_api with trace.api_org_id set (store.ts, api-db.ts).
import { canonicalNoticeText, noticeSha256 } from '@trace/shared/canonical-notice';
import type {
  AgeDeclareRpcIn,
  AgeDeclareRpcOut,
  CandidateTokenClaims,
  ConsentRecordRpcIn,
  ConsentRecordRpcOut,
  InviteResolveRpcIn,
  InviteResolveRpcOut,
  LobbyMintRpcIn,
  LobbyMintRpcOut,
  LobbyNext,
  MessagingSendRpcIn,
  MessagingSendRpcOut,
  NoticeGetRpcIn,
  NoticeGetRpcOut,
  PhotoPermitRpcIn,
  PhotoPermitRpcOut,
  SessionGrantRpcIn,
  SessionGrantRpcOut,
  SessionStartedRpcIn,
  SessionStartedRpcOut,
} from '@trace/shared/contracts/candidate';
import type { OutboxWriter } from '../outbox/outbox-writer.js';
import { randomBase64Url, sha256Hex } from './encoding.js';
import { fail, FailAfterCommit } from './errors.js';
import type { CandidateStore, InvitationRow, InvitationStatus, OrgStore } from './store.js';
import {
  LOBBY_TTL_SECONDS,
  SESSION_TTL_CAP_SECONDS,
  signCandidateToken,
  verifyCandidateToken,
  type SigningKey,
  type VerifyKeys,
} from './token.js';

export interface CandidateDeps {
  store: CandidateStore;
  /** The signing key from CANDIDATE_TOKEN_PRIVATE_JWK (its own kid). */
  signer: () => Promise<SigningKey>;
  /** The verify keys from CANDIDATE_TOKEN_PUBLIC_JWK. */
  verifyKeys: () => Promise<VerifyKeys>;
  outbox: OutboxWriter;
  /** Epoch milliseconds. */
  now: () => number;
  newId: () => string;
  newNonce: () => string;
}

const LIVE_BEFORE_START: readonly InvitationStatus[] = ['created', 'sent', 'otp_verified'];
const isStarted = (s: InvitationStatus) => s === 'started' || s === 'submitted';
const sec = (ms: number) => Math.floor(ms / 1000);
const isoSec = (s: number) => new Date(s * 1000).toISOString();

export const DEFAULT_NONCE = (): string => randomBase64Url(24);

/** A terminal status the candidate cannot get past, as its constant code. */
const refuseTerminal = (inv: InvitationRow): void => {
  if (inv.status === 'blocked_age' || inv.adultConfirmedByInviter === false) fail('not_eligible');
  if (inv.status === 'revoked') fail('link_revoked');
  if (inv.status === 'expired') fail('link_expired');
};

export const createCandidateService = (deps: CandidateDeps) => {
  const nowSec = () => sec(deps.now());
  const pastExpiry = (inv: { expiresAt: string }) => deps.now() > Date.parse(inv.expiresAt);

  /**
   * Refuses a dead link for a new login, grant or lobby step (spec §4.1 `expired` row): a past `expires_at` before
   * the session started is `link_expired`, and is written as `expired` only while no session id exists (L-32). A
   * started or submitted invitation is never cut short (resume and receipt). The refusal is a FailAfterCommit, so
   * the `expired` write commits (DB review r3 m-1); a plain throw would roll it back with the transaction.
   */
  const refuseDeadLink = async (s: OrgStore, inv: InvitationRow): Promise<void> => {
    refuseTerminal(inv);
    if (!isStarted(inv.status) && pastExpiry(inv)) {
      if (inv.sessionId === null) await s.markExpired(inv.id);
      throw new FailAfterCommit('link_expired');
    }
  };

  /**
   * One trace_api transaction for `orgId`. A FailAfterCommit thrown inside ends the transaction normally (the writes
   * before it commit) and is raised as its constant code after COMMIT; every other throw still rolls back.
   */
  const inOrg = async <T>(orgId: string, fn: (s: OrgStore) => Promise<T>): Promise<T> => {
    const out = await deps.store.withOrg(orgId, async (s) => {
      try {
        return { ok: true as const, value: await fn(s) };
      } catch (err) {
        if (err instanceof FailAfterCommit) return { ok: false as const, code: err.code };
        throw err;
      }
    });
    return out.ok ? out.value : fail(out.code);
  };

  /** Re-verifies the lobby token and loads the invitation it names, inside one trace_api transaction. */
  const withLobby = async <T>(
    lobbyToken: string,
    fn: (s: OrgStore, inv: InvitationRow, claims: CandidateTokenClaims) => Promise<T>,
  ): Promise<T> => {
    const claims = await verifyCandidateToken(
      lobbyToken,
      await deps.verifyKeys(),
      'lobby',
      nowSec(),
    ).catch((err: unknown) =>
      fail(
        err instanceof Error && err.message === 'token_expired' ? 'token_expired' : 'token_invalid',
      ),
    );
    return inOrg(claims.org_id, async (s) => {
      const inv = await s.invitation(claims.invitation_id);
      if (inv === null || inv.candidateId !== claims.candidate_id || inv.orgId !== claims.org_id) {
        return fail('token_invalid');
      }
      return fn(s, inv, claims);
    });
  };

  /** Age before consent (D1-13, rule 9): every lobby step after the age step needs a self-declared adult. */
  const requireAdult = (inv: InvitationRow): void => {
    if (inv.adultSelfDeclared !== true) fail('step_required');
  };

  const renderNotice = async (s: OrgStore, inv: InvitationRow) => {
    const tv = await s.testVersion(inv.testVersionId);
    if (tv === null || tv.noticeVersionId === null || tv.rulesetVersionId === null)
      return fail('unavailable');
    const notice = await s.notice(tv.noticeVersionId);
    if (notice === null) return fail('unavailable');
    // The seeded v1 notice has no placeholders; a template that needs values fails closed (canonical-notice).
    let bodyText: string;
    try {
      bodyText = canonicalNoticeText(notice.bodyTemplate, {});
    } catch {
      return fail('unavailable');
    }
    return { tv, notice, bodyText, renderedSha256: await noticeSha256(bodyText) };
  };

  const nextStep = async (s: OrgStore, inv: InvitationRow): Promise<LobbyNext> => {
    if (isStarted(inv.status)) return 'start';
    if (inv.adultSelfDeclared !== true) return 'age';
    return (await s.consent(inv.id)) === null ? 'consent' : 'photo';
  };

  return {
    async inviteResolve(input: InviteResolveRpcIn): Promise<InviteResolveRpcOut> {
      const found = await deps.store.resolveByHash(await sha256Hex(input.token));
      if (found === null) return fail('invalid_link');
      let state = found.status;
      let durationMinutes: number | undefined;
      let title = null as string | null;
      await inOrg(found.orgId, async (s) => {
        if (
          LIVE_BEFORE_START.includes(found.status) &&
          found.sessionId === null &&
          deps.now() > Date.parse(found.expiresAt) &&
          (await s.markExpired(found.id))
        ) {
          state = 'expired';
        }
        if (LIVE_BEFORE_START.includes(state) || state === 'started') {
          const tv = await s.testVersion(found.testVersionId);
          if (tv !== null) {
            durationMinutes = Math.min(120, Math.max(1, Math.ceil(tv.totalTimeSeconds / 60)));
            // Fix round 1 #8: the title is the test's name, read in this transaction; the package is never read.
            title = await s.testTitle(found.testVersionId);
          }
        }
      });
      return {
        invitationId: found.id,
        orgId: found.orgId,
        candidateId: found.candidateId,
        state,
        ...(title === null ? {} : { title }),
        ...(durationMinutes === undefined ? {} : { durationMinutes }),
      };
    },

    async messagingSend(input: MessagingSendRpcIn): Promise<MessagingSendRpcOut> {
      await inOrg(input.orgId, async (s) => {
        const inv = await s.invitation(input.invitationId);
        if (inv === null) return fail('invalid_link');
        await refuseDeadLink(s, inv);
        // The api resolves the address itself; the edge never sees it (§4.2). Outbox first, then `sent` (L-1).
        await deps.outbox.write(input.orgId, {
          kind: 'otp',
          to: inv.contactEmail,
          candidateLabel: inv.candidateLabel,
          bodyText: `Your Trace sign-in code is ${input.code}. It expires in 10 minutes. If you did not ask for it, ignore this message.`,
          idempotencyKey: `otp:${input.idempotencyKey}`,
        });
        if (inv.status === 'created') await s.moveStatus(inv.id, ['created'], 'sent');
      });
      return { ok: true };
    },

    async lobbyMint(input: LobbyMintRpcIn): Promise<LobbyMintRpcOut> {
      return inOrg(input.orgId, async (s) => {
        const inv = await s.invitation(input.invitationId);
        if (inv === null) return fail('invalid_link');
        await refuseDeadLink(s, inv);
        // First verify moves created/sent to otp_verified; later logins (resume) leave the state alone (§4.1).
        let current = inv;
        if (inv.status === 'created' || inv.status === 'sent') {
          if (await s.moveStatus(inv.id, ['created', 'sent'], 'otp_verified')) {
            current = { ...inv, status: 'otp_verified' };
          } else {
            // The conditional UPDATE moved nothing: the row changed since the read (an org revoke won the race,
            // DB review r3 n-2). Re-read and refuse on its stored state; no token is minted from the stale one.
            const again = (await s.invitation(inv.id)) ?? fail('invalid_link');
            refuseTerminal(again);
            current = again;
          }
        }
        const iat = nowSec();
        const exp = iat + LOBBY_TTL_SECONDS;
        const lobbyToken = await signCandidateToken(await deps.signer(), {
          sub: inv.candidateId,
          candidate_id: inv.candidateId,
          invitation_id: inv.id,
          org_id: inv.orgId,
          typ: 'lobby',
          nonce: input.nonce,
          iat,
          exp,
        });
        return { lobbyToken, expiresAt: isoSec(exp), next: await nextStep(s, current) };
      });
    },

    async ageDeclare(input: AgeDeclareRpcIn): Promise<AgeDeclareRpcOut> {
      return withLobby(input.lobbyToken, async (s, inv) => {
        // blocked_age is sticky: a later "adult" answer cannot undo it (rule 9, L-31).
        if (inv.status === 'blocked_age') return { blocked: true };
        refuseTerminal(inv);
        if (inv.adultSelfDeclared !== null) {
          // Set once. A replay of the same answer is idempotent; a changed answer is refused (open question).
          if (inv.adultSelfDeclared === input.adult) return { blocked: !input.adult };
          return fail('step_required');
        }
        if (inv.status !== 'otp_verified') return fail('step_required');
        const status = await s.declareAdult(inv.id, input.adult);
        if (status === null) return fail('unavailable');
        return { blocked: status === 'blocked_age' };
      });
    },

    async noticeGet(input: NoticeGetRpcIn): Promise<NoticeGetRpcOut> {
      return withLobby(input.lobbyToken, async (s, inv) => {
        await refuseDeadLink(s, inv);
        requireAdult(inv);
        const r = await renderNotice(s, inv);
        return {
          noticeVersionId: r.notice.id,
          language: 'en',
          bodyText: r.bodyText,
          renderedSha256: r.renderedSha256,
        };
      });
    },

    async consentRecord(input: ConsentRecordRpcIn): Promise<ConsentRecordRpcOut> {
      return withLobby(input.lobbyToken, async (s, inv) => {
        await refuseDeadLink(s, inv);
        requireAdult(inv);
        const existing = await s.consent(inv.id);
        if (existing === null) {
          if (inv.status !== 'otp_verified') return fail('step_required');
          const r = await renderNotice(s, inv);
          if (input.noticeVersionId !== r.notice.id || input.renderedSha256 !== r.renderedSha256) {
            return fail('bad_request');
          }
          await s.insertConsent({
            id: deps.newId(),
            invitationId: inv.id,
            testVersionId: inv.testVersionId,
            rulesetVersionId: r.tv.rulesetVersionId ?? fail('unavailable'),
            noticeVersionId: r.notice.id,
            renderedSha256: r.renderedSha256,
          });
          if ((await s.consent(inv.id)) === null) return fail('unavailable');
        }
        // R-10: the session id is minted at consent, so the photo key and the SessionDO address exist before start.
        if (inv.sessionId === null && !(await s.setSessionId(inv.id, deps.newId()))) {
          const again = await s.invitation(inv.id);
          if (again?.sessionId === null || again === null) return fail('unavailable');
        }
        return { ok: true };
      });
    },

    async photoPermit(input: PhotoPermitRpcIn): Promise<PhotoPermitRpcOut> {
      return withLobby(input.lobbyToken, async (s, inv) => {
        await refuseDeadLink(s, inv);
        requireAdult(inv);
        // The consent row exists before any photo (D1-13, Q36).
        if ((await s.consent(inv.id)) === null || inv.sessionId === null)
          return fail('step_required');
        return { orgId: inv.orgId, sessionId: inv.sessionId, locked: isStarted(inv.status) };
      });
    },

    async sessionGrant(input: SessionGrantRpcIn): Promise<SessionGrantRpcOut> {
      return withLobby(input.lobbyToken, async (s, inv) => {
        await refuseDeadLink(s, inv);
        requireAdult(inv);
        const consent = await s.consent(inv.id);
        if (consent === null || inv.sessionId === null) return fail('step_required');
        if (inv.status !== 'otp_verified' && !isStarted(inv.status)) return fail('step_required');
        const tv = await s.testVersion(inv.testVersionId);
        if (
          tv === null ||
          (tv.status !== 'published' && tv.status !== 'retired') ||
          tv.contentSha256 === null ||
          tv.rulesetVersionId === null
        ) {
          return fail('unavailable');
        }
        const resume = isStarted(inv.status);
        const nonce = deps.newNonce();
        const iat = nowSec();
        const exp = iat + Math.min(tv.totalTimeSeconds + 3600, SESSION_TTL_CAP_SECONDS);
        const sessionToken = await signCandidateToken(await deps.signer(), {
          sub: inv.candidateId,
          candidate_id: inv.candidateId,
          invitation_id: inv.id,
          org_id: inv.orgId,
          typ: 'session',
          nonce,
          iat,
          exp,
        });
        // sessionGrant changes no status (L-12): `started` is set by sessionStarted after the DO acknowledged.
        return {
          resume,
          startedAt: resume ? inv.startedAt : null,
          durationSeconds: tv.totalTimeSeconds,
          sessionToken,
          nonce,
          packageKey: `packages/${tv.id}.json`,
          packageSha256: tv.contentSha256,
          testVersionId: tv.id,
          rulesetVersionId: tv.rulesetVersionId,
          consentId: consent.id,
          adultConfirmed: true,
          sessionId: inv.sessionId,
        };
      });
    },

    async sessionStarted(input: SessionStartedRpcIn): Promise<SessionStartedRpcOut> {
      return inOrg(input.orgId, async (s) => {
        const inv = await s.invitation(input.invitationId);
        if (inv === null) return fail('invalid_link');
        if (inv.sessionId !== input.sessionId) return fail('bad_request');
        if (inv.status === 'started' && inv.startedAt !== null) return { startedAt: inv.startedAt };
        if (inv.status === 'submitted') {
          // DB review m2 m-2 (R3 decision): the mirror already stored the session (its sessions row holds the DO's
          // started_at) and `submitted` is terminal, so a late sessionStarted writes nothing and succeeds with the
          // stored value, or the DO's own value when the invitation never recorded one.
          return { startedAt: inv.startedAt ?? input.startedAt };
        }
        refuseTerminal(inv);
        if (inv.status !== 'otp_verified' || inv.adultSelfDeclared !== true)
          return fail('step_required');
        const stored = await s.markStarted(inv.id, input.sessionId, input.startedAt);
        if (stored !== null) return { startedAt: stored };
        const again = await s.invitation(inv.id);
        if (again !== null && again.status === 'started' && again.startedAt !== null) {
          return { startedAt: again.startedAt };
        }
        return fail('unavailable');
      });
    },
  };
};

export type CandidateService = ReturnType<typeof createCandidateService>;
