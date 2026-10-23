// AT-D12 (age cases), AT-D33, AT-D34, AT-D35 (api half): the CandidateRpc methods (spec §4.1, §4.2, §4.3, §10-DB,
// L-12, L-17, L-31, L-32; DB review m2 m-2). The service runs on the in-memory store of candidate.test-helpers.ts,
// which applies the guard rules of migration 2; the trace_api preamble is api-db.test.ts. Synthetic data only.
import type { CandidateErrorCode } from '@trace/shared/contracts/candidate';
import { createLogger } from '@trace/shared/log';
import { describe, expect, it } from 'vitest';
import { createDemoOutbox } from '../outbox/outbox-writer.js';
import { fakeOutboxNamespace } from '../outbox/outbox.test-helpers.js';
import {
  CandidateRpc,
  depsFromEnv,
  runCandidateMethod,
  type CandidateMethod,
} from './candidate-rpc.js';
import {
  NOTICE,
  NOTICE_TEXT,
  ORG,
  ORG_B,
  TV,
  fakeStore,
  makeTestKeys,
  type TestKeys,
} from './candidate.test-helpers.js';
import { sha256Hex } from './encoding.js';
import { createCandidateService, type CandidateDeps } from './service.js';
import { signCandidateToken } from './token.js';

const NOW = Date.parse('2026-10-17T08:00:00.000Z');
const LINK = 'A'.repeat(43);
const NONCE = 'lobby-nonce-0123456789';

const setup = async (opts: { keys?: TestKeys; now?: number } = {}) => {
  const fake = fakeStore();
  const keys = opts.keys ?? (await makeTestKeys());
  const ns = fakeOutboxNamespace();
  const outbox = createDemoOutbox({ TRACE_ENV: 'dev', DEMO_OUTBOX: '1' }, ns);
  if (outbox === null) throw new Error('outbox');
  let id = 0;
  const deps: CandidateDeps = {
    store: fake.store,
    signer: async () => keys.signer,
    verifyKeys: async () => keys.keys,
    outbox,
    packageTitle: async () => 'Synthetic Test',
    now: () => opts.now ?? NOW,
    newId: () => {
      id += 1;
      return `88888888-8888-4888-8888-${String(id).padStart(12, '0')}`;
    },
    newNonce: () => 'session-nonce-0123456789',
  };
  const svc = createCandidateService(deps);
  const lines: string[] = [];
  const log = createLogger({ service: 'api', version: 'dev', sink: (l) => lines.push(l) });
  const run = <M extends CandidateMethod>(method: M, input: unknown) =>
    runCandidateMethod(method, input, () => ({ deps, close: async () => {} }), log);
  return { fake, keys, ns, outbox, svc, deps, run, lines };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof Error ? err.message : 'non-error';
  }
};

/** Walks an invitation to the lobby: OTP verified, lobby token minted. */
const toLobby = async (ctx: Ctx, patch = {}) => {
  const inv = ctx.fake.addInvitation(patch);
  const minted = await ctx.svc.lobbyMint({ invitationId: inv.id, orgId: ORG, nonce: NONCE });
  return { inv, token: minted.lobbyToken, next: minted.next };
};

const toConsented = async (ctx: Ctx, patch = {}) => {
  const lobby = await toLobby(ctx, patch);
  await ctx.svc.ageDeclare({ lobbyToken: lobby.token, adult: true });
  const notice = await ctx.svc.noticeGet({ lobbyToken: lobby.token });
  await ctx.svc.consentRecord({
    lobbyToken: lobby.token,
    noticeVersionId: notice.noticeVersionId,
    renderedSha256: notice.renderedSha256,
    accepted: true,
  });
  return lobby;
};

const grant = (ctx: Ctx, token: string) =>
  ctx.svc.sessionGrant({
    lobbyToken: token,
    rulesAcknowledged: true,
    photo: { skippedReason: 'declined' },
  });

describe('inviteResolve', () => {
  it('finds the invitation by the SHA-256 of the link token, with the org unset', async () => {
    const ctx = await setup();
    const inv = ctx.fake.addInvitation({ linkHash: await sha256Hex(LINK) });
    const out = await ctx.run('inviteResolve', { token: LINK });
    expect(out).toEqual({
      invitationId: inv.id,
      orgId: ORG,
      candidateId: inv.candidateId,
      state: 'sent',
      title: 'Synthetic Test',
      durationMinutes: 30,
    });
    expect(ctx.fake.orgsSeen[0]).toBeNull();
    expect(JSON.stringify(out)).not.toContain('@example.test');
  });

  it('the title is tests.name read in the org transaction; the package body is never read (fix round 1 #8)', async () => {
    const ctx = await setup();
    ctx.fake.titles.set(TV, { orgId: ORG, name: 'Synthetic Stored Name' });
    let packageReads = 0;
    const deps = {
      ...ctx.deps,
      // A package reader that would hand back another title; it must never be called.
      ...({
        packageTitle: async () => {
          packageReads += 1;
          return 'Title from the package body';
        },
      } as object),
    } as CandidateDeps;
    const inv = ctx.fake.addInvitation({ linkHash: await sha256Hex(LINK) });
    const out = await createCandidateService(deps).inviteResolve({ token: LINK });
    expect(out).toMatchObject({ invitationId: inv.id, title: 'Synthetic Stored Name' });
    expect(packageReads).toBe(0);
    // One transaction for the org after the hash lookup: the title is read inside it.
    expect(ctx.fake.orgsSeen).toEqual([null, ORG]);
    // A version whose test name the org cannot see has no title (display data only).
    ctx.fake.titles.delete(TV);
    const again = await createCandidateService(deps).inviteResolve({ token: LINK });
    expect(again).not.toHaveProperty('title');
  });

  it('answers invalid_link for an unknown token', async () => {
    const ctx = await setup();
    expect(await code(ctx.run('inviteResolve', { token: LINK }))).toBe('invalid_link');
  });

  it('expires lazily a past link without a session id, and never one with a session id (L-32)', async () => {
    const ctx = await setup();
    ctx.fake.addInvitation({
      linkHash: await sha256Hex(LINK),
      expiresAt: '2026-10-01T00:00:00.000Z',
    });
    expect((await ctx.run('inviteResolve', { token: LINK })).state).toBe('expired');
    const ctx2 = await setup();
    ctx2.fake.addInvitation({
      linkHash: await sha256Hex(LINK),
      expiresAt: '2026-10-01T00:00:00.000Z',
      status: 'started',
      sessionId: '99999999-9999-4999-8999-999999999999',
      adultSelfDeclared: true,
      startedAt: '2026-09-30T00:00:00.000Z',
    });
    expect((await ctx2.run('inviteResolve', { token: LINK })).state).toBe('started');
  });

  it('refuses a malformed token before any lookup', async () => {
    const ctx = await setup();
    expect(await code(ctx.run('inviteResolve', { token: 'short' }))).toBe('bad_request');
    expect(await code(ctx.run('inviteResolve', { token: LINK, orgId: ORG }))).toBe('bad_request');
    expect(ctx.fake.orgsSeen).toEqual([]);
  });
});

describe('messagingSend (AT-D33)', () => {
  it('writes the outbox, then sets sent, and the answer holds no address', async () => {
    const ctx = await setup();
    const inv = ctx.fake.addInvitation({ status: 'created' });
    const out = await ctx.run('messagingSend', {
      invitationId: inv.id,
      orgId: ORG,
      code: '123456',
      idempotencyKey: 'otp-1',
    });
    expect(out).toEqual({ ok: true });
    expect(JSON.stringify(out)).not.toContain(inv.contactEmail);
    const entries = await ctx.outbox.list(ORG);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.bodyText).toContain('123456');
    expect(entries[0]?.candidateLabel).toBe(inv.candidateLabel);
    expect(ctx.fake.invitations.get(inv.id)?.status).toBe('sent');
    expect(ctx.fake.orgsSeen).toEqual([ORG]);
  });

  it('does not set sent when the outbox write fails', async () => {
    const ctx = await setup();
    const inv = ctx.fake.addInvitation({
      status: 'created',
      contactEmail: 'real.person@gmail.com',
    });
    expect(
      await code(
        ctx.run('messagingSend', {
          invitationId: inv.id,
          orgId: ORG,
          code: '123456',
          idempotencyKey: 'k',
        }),
      ),
    ).toBe('unavailable');
    expect(ctx.fake.invitations.get(inv.id)?.status).toBe('created');
  });

  it.each([
    ['blocked_age', 'not_eligible'],
    ['revoked', 'link_revoked'],
    ['expired', 'link_expired'],
  ] as const)('refuses a %s invitation with %s and sends nothing', async (status, expected) => {
    const ctx = await setup();
    const inv = ctx.fake.addInvitation({
      status,
      ...(status === 'blocked_age' ? { adultConfirmedByInviter: false } : {}),
    });
    expect(
      await code(
        ctx.run('messagingSend', {
          invitationId: inv.id,
          orgId: ORG,
          code: '123456',
          idempotencyKey: 'k',
        }),
      ),
    ).toBe(expected);
    expect(await ctx.outbox.list(ORG)).toEqual([]);
  });

  it('cannot reach an invitation of another org (the org comes from the edge claims)', async () => {
    const ctx = await setup();
    const inv = ctx.fake.addInvitation();
    expect(
      await code(
        ctx.run('messagingSend', {
          invitationId: inv.id,
          orgId: ORG_B,
          code: '123456',
          idempotencyKey: 'k',
        }),
      ),
    ).toBe('invalid_link');
  });
});

describe('lobbyMint', () => {
  it('moves sent to otp_verified and mints a 30-minute lobby token under the private key kid', async () => {
    const ctx = await setup();
    const { inv, token, next } = await toLobby(ctx);
    expect(next).toBe('age');
    expect(ctx.fake.invitations.get(inv.id)?.status).toBe('otp_verified');
    const header = JSON.parse(
      atob((token.split('.')[0] ?? '').replace(/-/g, '+').replace(/_/g, '/')),
    );
    expect(header.kid).toBe('d1-2026-10');
    const claims = JSON.parse(
      atob((token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')),
    );
    expect(claims).toMatchObject({
      typ: 'lobby',
      nonce: NONCE,
      invitation_id: inv.id,
      org_id: ORG,
    });
    expect(claims.exp - claims.iat).toBe(1800);
  });

  it('a revoke that wins the race against the first login mints no lobby token (DB review r3 n-2)', async () => {
    const ctx = await setup();
    const inv = ctx.fake.addInvitation();
    // The org revokes between the service's read and its created/sent -> otp_verified move.
    const racing: CandidateDeps['store'] = {
      ...ctx.fake.store,
      withOrg: (orgId, fn) =>
        ctx.fake.store.withOrg(orgId, (s) =>
          fn({
            ...s,
            invitation: async (id) => {
              const row = await s.invitation(id);
              const live = ctx.fake.invitations.get(id);
              if (live !== undefined && live.status === 'sent') live.status = 'revoked';
              return row;
            },
          }),
        ),
    };
    const svc = createCandidateService({ ...ctx.deps, store: racing });
    expect(await code(svc.lobbyMint({ invitationId: inv.id, orgId: ORG, nonce: NONCE }))).toBe(
      'link_revoked',
    );
    // (The simulated revoke ran inside this fake transaction, so the refusal rolls it back here; a real revoke is the
    // org's own committed transaction.) Nothing moved the invitation to otp_verified.
    expect(ctx.fake.invitations.get(inv.id)?.status).not.toBe('otp_verified');
  });

  it('refuses a past expiry before start and a blocked invitation', async () => {
    const ctx = await setup();
    const old = ctx.fake.addInvitation({ expiresAt: '2026-10-01T00:00:00.000Z' });
    expect(await code(ctx.svc.lobbyMint({ invitationId: old.id, orgId: ORG, nonce: NONCE }))).toBe(
      'link_expired',
    );
    expect(ctx.fake.invitations.get(old.id)?.status).toBe('expired');
    // The OTP send path commits `expired` too (the fake is transactional like postgres.js; DB review r3 m-1).
    const old2 = ctx.fake.addInvitation({ expiresAt: '2026-10-01T00:00:00.000Z' });
    expect(
      await code(
        ctx.svc.messagingSend({
          invitationId: old2.id,
          orgId: ORG,
          code: '123456',
          idempotencyKey: 'k1',
        }),
      ),
    ).toBe('link_expired');
    expect(ctx.fake.invitations.get(old2.id)?.status).toBe('expired');
    const minor = ctx.fake.addInvitation({ status: 'blocked_age', adultConfirmedByInviter: false });
    expect(
      await code(ctx.svc.lobbyMint({ invitationId: minor.id, orgId: ORG, nonce: NONCE })),
    ).toBe('not_eligible');
  });
});

describe('every method after lobbyMint re-verifies the lobby token (AT-D33)', () => {
  const lobbyMethods = (token: string) =>
    [
      ['ageDeclare', { lobbyToken: token, adult: true }],
      ['noticeGet', { lobbyToken: token }],
      [
        'consentRecord',
        {
          lobbyToken: token,
          noticeVersionId: NOTICE,
          renderedSha256: 'a'.repeat(64),
          accepted: true,
        },
      ],
      ['photoPermit', { lobbyToken: token }],
      [
        'sessionGrant',
        { lobbyToken: token, rulesAcknowledged: true, photo: { skippedReason: 'declined' } },
      ],
    ] as const;

  it('refuses a token signed by another key, an edited claim, a session token and an expired token', async () => {
    const ctx = await setup();
    const { inv, token } = await toLobby(ctx);
    const forger = await makeTestKeys();
    const claims = {
      sub: inv.candidateId,
      candidate_id: inv.candidateId,
      invitation_id: inv.id,
      org_id: ORG,
      typ: 'lobby',
      nonce: NONCE,
      iat: Math.floor(NOW / 1000),
      exp: Math.floor(NOW / 1000) + 600,
    };
    const forged = await signCandidateToken(forger.signer, claims);
    const session = await signCandidateToken(ctx.keys.signer, { ...claims, typ: 'session' });
    const expired = await signCandidateToken(ctx.keys.signer, {
      ...claims,
      iat: claims.iat - 1000,
      exp: claims.iat - 10,
    });
    const [h, , s] = token.split('.');
    const edited = `${h}.${btoa(JSON.stringify({ ...claims, org_id: ORG_B }))
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')}.${s}`;
    for (const [method, input] of lobbyMethods(forged)) {
      expect(await code(ctx.run(method, input))).toBe('token_invalid');
    }
    for (const [method, input] of lobbyMethods(session)) {
      expect(await code(ctx.run(method, input))).toBe('token_invalid');
    }
    for (const [method, input] of lobbyMethods(edited)) {
      expect(await code(ctx.run(method, input))).toBe('token_invalid');
    }
    for (const [method, input] of lobbyMethods(expired)) {
      expect(await code(ctx.run(method, input))).toBe('token_expired');
    }
    expect(ctx.fake.writes.filter((w) => w !== 'status:otp_verified')).toEqual([]);
  });

  it('refuses a valid token whose candidate is not the invitation candidate', async () => {
    const ctx = await setup();
    const { inv } = await toLobby(ctx);
    const other = await signCandidateToken(ctx.keys.signer, {
      sub: '12121212-1212-4121-8121-121212121212',
      candidate_id: '12121212-1212-4121-8121-121212121212',
      invitation_id: inv.id,
      org_id: ORG,
      typ: 'lobby',
      nonce: NONCE,
      iat: Math.floor(NOW / 1000),
      exp: Math.floor(NOW / 1000) + 600,
    });
    expect(await code(ctx.run('noticeGet', { lobbyToken: other }))).toBe('token_invalid');
  });

  it('discards nothing silently: an identity key in the input is a bad_request', async () => {
    const ctx = await setup();
    const { inv, token } = await toLobby(ctx);
    expect(await code(ctx.run('noticeGet', { lobbyToken: token, invitationId: inv.id }))).toBe(
      'bad_request',
    );
  });
});

describe('server step order (AT-D34) and under-18 (AT-D12)', () => {
  it('refuses the notice, consent, photo and grant before the age step', async () => {
    const ctx = await setup();
    const { token } = await toLobby(ctx);
    expect(await code(ctx.svc.noticeGet({ lobbyToken: token }))).toBe('step_required');
    expect(
      await code(
        ctx.svc.consentRecord({
          lobbyToken: token,
          noticeVersionId: NOTICE,
          renderedSha256: 'a'.repeat(64),
          accepted: true,
        }),
      ),
    ).toBe('step_required');
    expect(await code(ctx.svc.photoPermit({ lobbyToken: token }))).toBe('step_required');
    expect(await code(grant(ctx, token))).toBe('step_required');
    expect(ctx.fake.consents.size).toBe(0);
  });

  it('a self-declared minor is blocked, nothing else is created, and an adult answer cannot undo it', async () => {
    const ctx = await setup();
    const { inv, token } = await toLobby(ctx);
    expect(await ctx.run('ageDeclare', { lobbyToken: token, adult: false })).toEqual({
      blocked: true,
    });
    expect(ctx.fake.invitations.get(inv.id)).toMatchObject({
      status: 'blocked_age',
      adultSelfDeclared: false,
    });
    expect(await ctx.run('ageDeclare', { lobbyToken: token, adult: true })).toEqual({
      blocked: true,
    });
    expect(ctx.fake.invitations.get(inv.id)?.status).toBe('blocked_age');
    for (const p of [
      ctx.svc.noticeGet({ lobbyToken: token }),
      ctx.svc.consentRecord({
        lobbyToken: token,
        noticeVersionId: NOTICE,
        renderedSha256: 'a'.repeat(64),
        accepted: true,
      }),
      ctx.svc.photoPermit({ lobbyToken: token }),
      grant(ctx, token),
    ]) {
      expect(await code(p)).toBe('not_eligible');
    }
    expect(ctx.fake.consents.size).toBe(0);
    expect(ctx.fake.invitations.get(inv.id)?.sessionId).toBeNull();
  });

  it('an inviter "no" blocks before any OTP, login or grant', async () => {
    const ctx = await setup();
    const inv = ctx.fake.addInvitation({ status: 'blocked_age', adultConfirmedByInviter: false });
    expect(await code(ctx.svc.lobbyMint({ invitationId: inv.id, orgId: ORG, nonce: NONCE }))).toBe(
      'not_eligible',
    );
    expect(
      await code(
        ctx.svc.messagingSend({
          invitationId: inv.id,
          orgId: ORG,
          code: '123456',
          idempotencyKey: 'k',
        }),
      ),
    ).toBe('not_eligible');
  });

  it('an adult answer is set once: a changed answer is refused', async () => {
    const ctx = await setup();
    const { token } = await toLobby(ctx);
    expect(await ctx.svc.ageDeclare({ lobbyToken: token, adult: true })).toEqual({
      blocked: false,
    });
    expect(await ctx.svc.ageDeclare({ lobbyToken: token, adult: true })).toEqual({
      blocked: false,
    });
    expect(await code(ctx.svc.ageDeclare({ lobbyToken: token, adult: false }))).toBe(
      'step_required',
    );
  });
});

describe('notice and consent (AT-D33: the consent row exists before photoPermit succeeds)', () => {
  it('renders the pinned notice and stores its hash with the consent, then mints the session id', async () => {
    const ctx = await setup();
    const { inv, token } = await toLobby(ctx);
    await ctx.svc.ageDeclare({ lobbyToken: token, adult: true });
    expect(await code(ctx.svc.photoPermit({ lobbyToken: token }))).toBe('step_required');
    const notice = await ctx.run('noticeGet', { lobbyToken: token });
    expect(notice).toEqual({
      noticeVersionId: NOTICE,
      language: 'en',
      bodyText: NOTICE_TEXT,
      renderedSha256: await sha256Hex(NOTICE_TEXT),
    });
    expect(
      await ctx.run('consentRecord', {
        lobbyToken: token,
        noticeVersionId: NOTICE,
        renderedSha256: notice.renderedSha256,
        accepted: true,
      }),
    ).toEqual({ ok: true });
    const sessionId = ctx.fake.invitations.get(inv.id)?.sessionId;
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await ctx.run('photoPermit', { lobbyToken: token })).toEqual({
      orgId: ORG,
      sessionId,
      locked: false,
    });
  });

  it('a replayed consent is a no-op and keeps the same session id', async () => {
    const ctx = await setup();
    const { inv, token } = await toConsented(ctx);
    const first = ctx.fake.invitations.get(inv.id)?.sessionId;
    const notice = await ctx.svc.noticeGet({ lobbyToken: token });
    await ctx.svc.consentRecord({
      lobbyToken: token,
      noticeVersionId: notice.noticeVersionId,
      renderedSha256: notice.renderedSha256,
      accepted: true,
    });
    expect(ctx.fake.consents.size).toBe(1);
    expect(ctx.fake.invitations.get(inv.id)?.sessionId).toBe(first);
  });

  it('refuses a consent for another notice text or version', async () => {
    const ctx = await setup();
    const { token } = await toLobby(ctx);
    await ctx.svc.ageDeclare({ lobbyToken: token, adult: true });
    expect(
      await code(
        ctx.svc.consentRecord({
          lobbyToken: token,
          noticeVersionId: NOTICE,
          renderedSha256: 'a'.repeat(64),
          accepted: true,
        }),
      ),
    ).toBe('bad_request');
    expect(ctx.fake.consents.size).toBe(0);
  });
});

describe('sessionGrant and sessionStarted (AT-D33, AT-D35)', () => {
  it('grants without changing any status, with a session token capped at duration + 1 h', async () => {
    const ctx = await setup();
    const { inv, token } = await toConsented(ctx);
    const before = { ...ctx.fake.invitations.get(inv.id) };
    const out = await ctx.run('sessionGrant', {
      lobbyToken: token,
      rulesAcknowledged: true,
      photo: { skippedReason: 'camera_denied' },
    });
    expect(ctx.fake.invitations.get(inv.id)).toEqual(before);
    expect(out).toMatchObject({
      resume: false,
      startedAt: null,
      durationSeconds: 1800,
      packageKey: `packages/${inv.testVersionId}.json`,
      packageSha256: 'b'.repeat(64),
      adultConfirmed: true,
      sessionId: before.sessionId,
      nonce: 'session-nonce-0123456789',
    });
    const claims = JSON.parse(
      atob((out.sessionToken.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')),
    );
    expect(claims.typ).toBe('session');
    expect(claims.exp - claims.iat).toBe(1800 + 3600);
  });

  it('sessionStarted sets started and the set-once started_at; a retry returns the stored value', async () => {
    const ctx = await setup();
    const { inv, token } = await toConsented(ctx);
    const g = await grant(ctx, token);
    const first = await ctx.run('sessionStarted', {
      invitationId: inv.id,
      orgId: ORG,
      sessionId: g.sessionId,
      startedAt: '2026-10-17T08:00:05.000Z',
    });
    expect(first).toEqual({ startedAt: '2026-10-17T08:00:05.000Z' });
    expect(ctx.fake.invitations.get(inv.id)).toMatchObject({
      status: 'started',
      startedAt: '2026-10-17T08:00:05.000Z',
    });
    const retry = await ctx.run('sessionStarted', {
      invitationId: inv.id,
      orgId: ORG,
      sessionId: g.sessionId,
      startedAt: '2026-10-17T08:09:00.000Z',
    });
    expect(retry).toEqual({ startedAt: '2026-10-17T08:00:05.000Z' });
    const resume = await grant(ctx, token);
    expect(resume).toMatchObject({ resume: true, startedAt: '2026-10-17T08:00:05.000Z' });
  });

  it('a failed start leaves otp_verified, and a retried grant and start succeed (AT-D35)', async () => {
    const ctx = await setup();
    const { inv, token } = await toConsented(ctx);
    await grant(ctx, token);
    expect(ctx.fake.invitations.get(inv.id)?.status).toBe('otp_verified');
    const g = await grant(ctx, token);
    await ctx.svc.sessionStarted({
      invitationId: inv.id,
      orgId: ORG,
      sessionId: g.sessionId,
      startedAt: '2026-10-17T08:01:00.000Z',
    });
    expect(ctx.fake.invitations.get(inv.id)?.status).toBe('started');
  });

  it('refuses another session id and leaves the invitation as it was', async () => {
    const ctx = await setup();
    const { inv } = await toConsented(ctx);
    expect(
      await code(
        ctx.svc.sessionStarted({
          invitationId: inv.id,
          orgId: ORG,
          sessionId: '99999999-9999-4999-8999-999999999999',
          startedAt: '2026-10-17T08:01:00.000Z',
        }),
      ),
    ).toBe('bad_request');
    expect(ctx.fake.invitations.get(inv.id)?.status).toBe('otp_verified');
  });

  it('m-2: a late sessionStarted on a submitted invitation writes nothing and returns a start time', async () => {
    const ctx = await setup();
    const { inv } = await toConsented(ctx);
    const row = ctx.fake.invitations.get(inv.id);
    if (row === undefined || row.sessionId === null) throw new Error('fixture');
    row.status = 'submitted';
    const writes = ctx.fake.writes.length;
    const out = await ctx.svc.sessionStarted({
      invitationId: inv.id,
      orgId: ORG,
      sessionId: row.sessionId,
      startedAt: '2026-10-17T08:01:00.000Z',
    });
    expect(out).toEqual({ startedAt: '2026-10-17T08:01:00.000Z' });
    expect(ctx.fake.writes.length).toBe(writes);
    expect(row.startedAt).toBeNull();
  });

  it('a past expiry before start refuses the grant without writing expired once a session id exists (L-32)', async () => {
    const ctx = await setup({ now: Date.parse('2030-06-01T00:00:00.000Z') });
    const inv = ctx.fake.addInvitation({
      status: 'otp_verified',
      adultSelfDeclared: true,
      sessionId: '99999999-9999-4999-8999-999999999999',
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
    ctx.fake.consents.set('c1', { id: 'c1', invitationId: inv.id, orgId: ORG });
    const token = await signCandidateToken(ctx.keys.signer, {
      sub: inv.candidateId,
      candidate_id: inv.candidateId,
      invitation_id: inv.id,
      org_id: ORG,
      typ: 'lobby',
      nonce: NONCE,
      iat: Math.floor(Date.parse('2030-06-01T00:00:00.000Z') / 1000),
      exp: Math.floor(Date.parse('2030-06-01T00:00:00.000Z') / 1000) + 600,
    });
    expect(await code(grant(ctx, token))).toBe('link_expired');
    expect(ctx.fake.invitations.get(inv.id)?.status).toBe('otp_verified');
  });

  it('a started session past its link expiry still resumes (never cut short)', async () => {
    const ctx = await setup();
    const { inv, token } = await toConsented(ctx);
    const g = await grant(ctx, token);
    await ctx.svc.sessionStarted({
      invitationId: inv.id,
      orgId: ORG,
      sessionId: g.sessionId,
      startedAt: '2026-10-17T08:01:00.000Z',
    });
    const row = ctx.fake.invitations.get(inv.id);
    if (row !== undefined) row.expiresAt = '2026-10-17T07:00:00.000Z';
    expect((await grant(ctx, token)).resume).toBe(true);
  });

  it('refuses a grant when the pinned test version has no package hash (invalid package)', async () => {
    const ctx = await setup();
    const { token, inv } = await toConsented(ctx);
    const tv = ctx.fake.testVersions.get(inv.testVersionId);
    if (tv !== undefined) tv.contentSha256 = null;
    expect(await code(grant(ctx, token))).toBe('unavailable');
  });

  it('revoked and expired links refuse login (AT-D35)', async () => {
    const ctx = await setup();
    const revoked = ctx.fake.addInvitation({ status: 'revoked' });
    const expired = ctx.fake.addInvitation({ status: 'expired' });
    expect(
      await code(ctx.svc.lobbyMint({ invitationId: revoked.id, orgId: ORG, nonce: NONCE })),
    ).toBe('link_revoked');
    expect(
      await code(ctx.svc.lobbyMint({ invitationId: expired.id, orgId: ORG, nonce: NONCE })),
    ).toBe('link_expired');
  });
});

describe('runCandidateMethod', () => {
  it('maps an unexpected failure to unavailable and logs only the method and a SQLSTATE', async () => {
    const ctx = await setup();
    const boom = Object.assign(new Error('duplicate key (cand1@example.test)'), { code: '23505' });
    const result = await code(
      runCandidateMethod(
        'inviteResolve',
        { token: LINK },
        () => ({
          deps: {
            ...ctx.deps,
            store: { ...ctx.deps.store, resolveByHash: async () => Promise.reject(boom) },
          },
          close: async () => {},
        }),
        createLogger({ service: 'api', version: 'dev', sink: (l) => ctx.lines.push(l) }),
      ),
    );
    expect(result).toBe('unavailable');
    expect(ctx.lines.join('\n')).not.toContain('example.test');
    expect(ctx.lines.join('\n')).toContain('23505');
  });

  it('fails closed with unavailable when a binding is missing', async () => {
    const env = {} as Env;
    expect(
      await code(
        runCandidateMethod(
          'inviteResolve',
          { token: LINK },
          () => depsFromEnv(env),
          createLogger({ service: 'api', version: 'dev', sink: () => {} }),
        ),
      ),
    ).toBe('unavailable');
  });

  it('every thrown message is a constant candidate error code', async () => {
    const ctx = await setup();
    const codes: CandidateErrorCode[] = ['bad_request', 'invalid_link', 'unavailable'];
    expect(codes).toContain(await code(ctx.run('inviteResolve', { token: LINK })));
    expect(codes).toContain(await code(ctx.run('inviteResolve', null)));
  });
});

describe('CandidateRpc entrypoint', () => {
  it('validates input before anything and fails closed without bindings', async () => {
    // The entrypoint never reads ctx; a minimal stand-in is enough (as in src/index.test.ts).
    const ctx = {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext;
    const rpc = new CandidateRpc(ctx, {} as Env);
    expect(await code(rpc.inviteResolve({ token: 'x' }))).toBe('bad_request');
    expect(await code(rpc.inviteResolve({ token: LINK }))).toBe('unavailable');
    expect(await code(rpc.sessionStarted({ invitationId: 'not-a-uuid' }))).toBe('bad_request');
  });

  it('exposes exactly the nine contract methods', () => {
    const names = Object.getOwnPropertyNames(CandidateRpc.prototype).filter(
      (n) => n !== 'constructor',
    );
    expect(names.sort()).toEqual(
      [
        'ageDeclare',
        'consentRecord',
        'inviteResolve',
        'lobbyMint',
        'messagingSend',
        'noticeGet',
        'photoPermit',
        'sessionGrant',
        'sessionStarted',
      ].sort(),
    );
  });
});
