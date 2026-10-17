// Test doubles for the candidate path: an in-memory CandidateStore that applies the invitations and consents guard
// rules the database enforces (migration 2: forward-only status, set-once columns, age forces blocked_age, consent
// needs otp_verified and both adult answers, started needs a consent and the session id, expiry only without a
// session id), and run-time ES256 keys. Synthetic data only.
import { importSigningKey, parsePublicJwks, type SigningKey, type VerifyKeys } from './token.js';
import type {
  CandidateStore,
  ConsentRow,
  InvitationRow,
  InvitationStatus,
  NoticeRow,
  OrgStore,
  ResolvedInvitation,
  TestVersionRow,
} from './store.js';

export const ORG = '11111111-1111-4111-8111-111111111111';
export const ORG_B = '22222222-2222-4222-8222-222222222222';
export const TV = '33333333-3333-4333-8333-333333333333';
export const RULESET = '44444444-4444-4444-8444-444444444444';
export const NOTICE = '55555555-5555-4555-8555-555555555555';
export const NOTICE_TEXT =
  'Synthetic D1 candidate notice, version 1. Nothing is decided automatically.';

export interface FakeInvitation extends InvitationRow {
  linkHash: string;
}

export const fakeStore = () => {
  const invitations = new Map<string, FakeInvitation>();
  const consents = new Map<string, ConsentRow & { invitationId: string; orgId: string }>();
  const testVersions = new Map<string, TestVersionRow & { orgId: string }>();
  const notices = new Map<string, NoticeRow & { orgId: string }>();
  /** The org bound for each transaction, in order (null = the token-hash lookup). */
  const orgsSeen: (string | null)[] = [];
  const writes: string[] = [];

  const guardError = () => new Error('TRACE_GUARD: refused');

  const orgStore = (orgId: string): OrgStore => {
    const own = (id: string) => {
      const inv = invitations.get(id);
      return inv !== undefined && inv.orgId === orgId ? inv : undefined;
    };
    return {
      async invitation(id) {
        const inv = own(id);
        if (inv === undefined) return null;
        const row: InvitationRow & { linkHash?: string } = { ...inv };
        delete row.linkHash;
        return row;
      },
      async testVersion(id) {
        const tv = testVersions.get(id);
        if (tv === undefined || tv.orgId !== orgId) return null;
        return {
          id: tv.id,
          status: tv.status,
          totalTimeSeconds: tv.totalTimeSeconds,
          rulesetVersionId: tv.rulesetVersionId,
          noticeVersionId: tv.noticeVersionId,
          contentSha256: tv.contentSha256,
        };
      },
      async notice(id) {
        const n = notices.get(id);
        return n === undefined || n.orgId !== orgId
          ? null
          : { id: n.id, bodyTemplate: n.bodyTemplate };
      },
      async consent(invitationId) {
        const c = [...consents.values()].find(
          (x) => x.invitationId === invitationId && x.orgId === orgId,
        );
        return c === undefined ? null : { id: c.id };
      },
      async insertConsent(row) {
        writes.push('consent');
        const inv = own(row.invitationId);
        if (inv === undefined) throw guardError();
        if ([...consents.values()].some((c) => c.invitationId === row.invitationId)) return;
        if (inv.status !== 'otp_verified') throw guardError();
        if (inv.adultConfirmedByInviter === false || inv.adultSelfDeclared !== true)
          throw guardError();
        consents.set(row.id, { id: row.id, invitationId: row.invitationId, orgId });
      },
      async moveStatus(id, from, to) {
        writes.push(`status:${to}`);
        const inv = own(id);
        if (inv === undefined || !from.includes(inv.status)) return false;
        inv.status = to;
        return true;
      },
      async declareAdult(id, adult) {
        writes.push('adult');
        const inv = own(id);
        if (inv === undefined || inv.adultSelfDeclared !== null) return null;
        if (['submitted', 'expired', 'revoked', 'blocked_age'].includes(inv.status))
          throw guardError();
        inv.adultSelfDeclared = adult;
        if (!adult) inv.status = 'blocked_age';
        return inv.status;
      },
      async setSessionId(id, sessionId) {
        writes.push('session_id');
        const inv = own(id);
        if (inv === undefined || inv.sessionId !== null) return false;
        if (![...consents.values()].some((c) => c.invitationId === id)) throw guardError();
        inv.sessionId = sessionId;
        return true;
      },
      async markStarted(id, sessionId, startedAt) {
        writes.push('started');
        const inv = own(id);
        if (inv === undefined || inv.sessionId !== sessionId || inv.status !== 'otp_verified')
          return null;
        if (![...consents.values()].some((c) => c.invitationId === id)) throw guardError();
        if (inv.adultSelfDeclared !== true) throw guardError();
        inv.status = 'started';
        inv.startedAt = new Date(startedAt).toISOString();
        return inv.startedAt;
      },
      async markExpired(id) {
        writes.push('expired');
        const inv = own(id);
        if (inv === undefined || inv.sessionId !== null) return false;
        if (!['created', 'sent', 'otp_verified'].includes(inv.status)) return false;
        inv.status = 'expired';
        return true;
      },
    };
  };

  const store: CandidateStore = {
    async resolveByHash(hash): Promise<ResolvedInvitation | null> {
      orgsSeen.push(null);
      const inv = [...invitations.values()].find((i) => i.linkHash === hash);
      if (inv === undefined) return null;
      return {
        orgId: inv.orgId,
        id: inv.id,
        status: inv.status,
        candidateId: inv.candidateId,
        sessionId: inv.sessionId,
        testVersionId: inv.testVersionId,
        expiresAt: inv.expiresAt,
      };
    },
    async withOrg(orgId, fn) {
      orgsSeen.push(orgId);
      return fn(orgStore(orgId));
    },
  };

  testVersions.set(TV, {
    id: TV,
    orgId: ORG,
    status: 'published',
    totalTimeSeconds: 1800,
    rulesetVersionId: RULESET,
    noticeVersionId: NOTICE,
    contentSha256: 'b'.repeat(64),
  });
  notices.set(NOTICE, { id: NOTICE, orgId: ORG, bodyTemplate: NOTICE_TEXT });

  let n = 0;
  const addInvitation = (patch: Partial<FakeInvitation> = {}): FakeInvitation => {
    n += 1;
    const id = `66666666-6666-4666-8666-${String(n).padStart(12, '0')}`;
    const inv: FakeInvitation = {
      id,
      orgId: ORG,
      status: 'sent' as InvitationStatus,
      candidateId: `77777777-7777-4777-8777-${String(n).padStart(12, '0')}`,
      sessionId: null,
      startedAt: null,
      testVersionId: TV,
      candidateLabel: `Candidate ${n}`,
      contactEmail: `cand${n}@example.test`,
      adultConfirmedByInviter: true,
      adultSelfDeclared: null,
      expiresAt: '2030-01-01T00:00:00.000Z',
      linkHash: 'f'.repeat(64),
      ...patch,
    };
    invitations.set(id, inv);
    return inv;
  };

  return { store, invitations, consents, testVersions, notices, orgsSeen, writes, addInvitation };
};

export interface TestKeys {
  signer: SigningKey;
  keys: VerifyKeys;
  privateText: string;
  publicText: string;
}

export const makeTestKeys = async (kid = 'd1-2026-10'): Promise<TestKeys> => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const priv = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const privateText = JSON.stringify({
    kty: priv.kty,
    crv: priv.crv,
    x: priv.x,
    y: priv.y,
    d: priv.d,
    kid,
  });
  const publicText = JSON.stringify([
    { kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y, kid, alg: 'ES256', use: 'sig' },
  ]);
  return {
    signer: await importSigningKey(privateText),
    keys: await parsePublicJwks(publicText),
    privateText,
    publicText,
  };
};
