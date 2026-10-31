// AT-M2-34, OTP part (specs/m2-scheduling-invites.md R5-19, §6.6): the OTP purpose is bound at issue. The challenge
// stores it; `verify` mints by the stored purpose (a `lobby` code → api `lobbyMint` → a lobby token; a `manage` code →
// api `portalMint` → a portal token), never by anything sent at verify. The portal nonce lives under its own key
// (`portal:nonce_hash`), so a manage login never supersedes the lobby token or the reverse. The 3-per-10-min issue
// budget and the 30 s resend wait are shared across purposes. An absent purpose is `lobby` (the D1 app sends none).
// The logic runs on the Map-backed fake of the object's KV; the routes run through the real app. Synthetic data only.
import { OtpVerifyPortalRes, OtpVerifyRes } from '@trace/shared/contracts/candidate';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './encoding.js';
import { createHarness, LINK, MapKv, type Harness } from './edge.test-helpers.js';
import { OtpCore, RESEND_AFTER_MS, type IssueResult } from './otp-core.js';
import { INVITATION, nonce } from './token.test-helpers.js';

const T0 = 1_790_000_000_000;

const setup = () => {
  const clock = { ms: T0 };
  const kv = new MapKv();
  const core = new OtpCore(kv, { now: () => clock.ms });
  return { clock, kv, core };
};

const issued = (r: IssueResult) => {
  if (!r.ok) throw new Error(`expected an issue, got ${r.error}`);
  return r;
};

const verifiedNonce = (r: Awaited<ReturnType<OtpCore['verify']>>) => {
  if (!r.ok) throw new Error(`expected a verify, got ${r.error}`);
  return r;
};

describe('OtpCore: the purpose is stored at issue (R5-19)', () => {
  it('an issue without a purpose stores `lobby`; with `manage` it stores `manage`', async () => {
    const { core, kv, clock } = setup();
    issued(await core.issue());
    expect(kv.get<{ purpose: string }>('otp:challenge')?.purpose).toBe('lobby');
    clock.ms += RESEND_AFTER_MS;
    issued(await core.issue('manage'));
    expect(kv.get<{ purpose: string }>('otp:challenge')?.purpose).toBe('manage');
  });

  it('verify answers the stored purpose with the nonce', async () => {
    const { core, clock } = setup();
    const lobby = issued(await core.issue('lobby'));
    expect(verifiedNonce(await core.verify(lobby.code)).purpose).toBe('lobby');
    clock.ms += RESEND_AFTER_MS;
    const manage = issued(await core.issue('manage'));
    expect(verifiedNonce(await core.verify(manage.code)).purpose).toBe('manage');
  });

  it('a challenge stored before M2 (no purpose) verifies as `lobby`', async () => {
    const { core, kv } = setup();
    const r = issued(await core.issue());
    const stored = kv.get<Record<string, unknown>>('otp:challenge') ?? {};
    delete stored.purpose;
    kv.put('otp:challenge', stored);
    expect(verifiedNonce(await core.verify(r.code)).purpose).toBe('lobby');
  });

  it('a manage verify stores the portal nonce hash and leaves the lobby nonce untouched, and the reverse', async () => {
    const { core, kv, clock } = setup();
    const lobby = verifiedNonce(await core.verify(issued(await core.issue('lobby')).code));
    const lobbyHash = kv.get<string>('lobby:nonce_hash');
    expect(lobbyHash).toBe(await sha256Hex(lobby.nonce));
    expect(kv.get('portal:nonce_hash')).toBeUndefined();

    clock.ms += RESEND_AFTER_MS;
    const portal = verifiedNonce(await core.verify(issued(await core.issue('manage')).code));
    expect(kv.get<string>('portal:nonce_hash')).toBe(await sha256Hex(portal.nonce));
    expect(kv.get<string>('lobby:nonce_hash')).toBe(lobbyHash);

    clock.ms += RESEND_AFTER_MS;
    const lobby2 = verifiedNonce(await core.verify(issued(await core.issue()).code));
    expect(kv.get<string>('lobby:nonce_hash')).toBe(await sha256Hex(lobby2.nonce));
    expect(kv.get<string>('portal:nonce_hash')).toBe(await sha256Hex(portal.nonce));
  });

  it('lobby and portal gates are independent: each accepts only its own nonce', async () => {
    const { core, clock } = setup();
    const lobby = verifiedNonce(await core.verify(issued(await core.issue()).code));
    clock.ms += RESEND_AFTER_MS;
    const portal = verifiedNonce(await core.verify(issued(await core.issue('manage')).code));

    expect(await core.lobbyGate(lobby.nonce, 'age')).toEqual({ ok: true });
    expect(await core.portalGate(portal.nonce, 'portal_slots')).toEqual({ ok: true });
    // A portal nonce is never a lobby credential, and the reverse.
    expect(await core.lobbyGate(portal.nonce, 'age')).toEqual({ ok: false, error: 'superseded' });
    expect(await core.portalGate(lobby.nonce, 'portal_slots')).toEqual({
      ok: false,
      error: 'superseded',
    });
  });

  it('a portal gate with no manage login is token_invalid; clearLobbyNonce leaves the portal nonce', async () => {
    const { core, clock } = setup();
    const lobby = verifiedNonce(await core.verify(issued(await core.issue()).code));
    expect(await core.portalGate(lobby.nonce, 'portal_slots')).toEqual({
      ok: false,
      error: 'token_invalid',
    });
    clock.ms += RESEND_AFTER_MS;
    const portal = verifiedNonce(await core.verify(issued(await core.issue('manage')).code));
    core.clearLobbyNonce();
    expect(await core.portalGate(portal.nonce, 'portal_slots')).toEqual({ ok: true });
  });

  it('a lobby bucket is not a portal bucket and the reverse (token_invalid, nothing counted)', async () => {
    const { core } = setup();
    const portal = verifiedNonce(await core.verify(issued(await core.issue('manage')).code));
    expect(
      await core.portalGate(portal.nonce, 'age' as unknown as Parameters<OtpCore['portalGate']>[1]),
    ).toEqual({ ok: false, error: 'token_invalid' });
    expect(await core.lobbyGate(nonce(), 'portal_slots' as unknown as 'age')).toEqual({
      ok: false,
      error: 'token_invalid',
    });
  });

  it('the issue budget is shared across purposes: 3 per 10 minutes, then rate_limited', async () => {
    const { core, clock } = setup();
    issued(await core.issue('lobby'));
    clock.ms += RESEND_AFTER_MS;
    issued(await core.issue('manage'));
    clock.ms += RESEND_AFTER_MS;
    issued(await core.issue('lobby'));
    clock.ms += RESEND_AFTER_MS;
    expect(await core.issue('manage')).toMatchObject({ ok: false, error: 'rate_limited' });
    expect(await core.issue('lobby')).toMatchObject({ ok: false, error: 'rate_limited' });
  });

  it('the 30 s resend wait is shared across purposes', async () => {
    const { core, clock } = setup();
    issued(await core.issue('lobby'));
    clock.ms += 5_000;
    expect(await core.issue('manage')).toEqual({
      ok: false,
      error: 'resend_too_soon',
      retryAfterSeconds: 25,
    });
  });

  it('verify with an allowed list: a correct code of another stored purpose is lobby_closed and not consumed', async () => {
    const { core, kv, clock } = setup();
    const lobby = issued(await core.issue('lobby'));
    const before = kv.get('otp:challenge');
    expect(await core.verify(lobby.code, ['manage'])).toEqual({ ok: false, error: 'lobby_closed' });
    expect(kv.get('otp:challenge')).toEqual(before);
    expect(kv.get('otp:failures')).toBeUndefined();
    expect(kv.get('lobby:nonce_hash')).toBeUndefined();
    // The same code still verifies once the purpose is allowed.
    expect(verifiedNonce(await core.verify(lobby.code)).purpose).toBe('lobby');
    clock.ms += RESEND_AFTER_MS;
    const manage = issued(await core.issue('manage'));
    expect(verifiedNonce(await core.verify(manage.code, ['manage'])).purpose).toBe('manage');
  });

  it('no pending-code oracle (decision c): a wrong code with a closed purpose is otp_wrong and counted, as any wrong code', async () => {
    const { core, kv } = setup();
    const lobby = issued(await core.issue('lobby'));
    const wrong = lobby.code === '000000' ? '000001' : '000000';
    // The answer is the same as for a wrong code with no closed purpose: it says nothing about a pending lobby code.
    expect(await core.verify(wrong, ['manage'])).toEqual({ ok: false, error: 'otp_wrong' });
    expect(kv.get('otp:failures')).toBe(1);
    for (let i = 2; i < 5; i += 1) {
      expect(await core.verify(wrong, ['manage'])).toEqual({ ok: false, error: 'otp_wrong' });
    }
    expect(await core.verify(wrong, ['manage'])).toMatchObject({
      ok: false,
      error: 'otp_locked',
      lockedNow: true,
    });
    // The lock drops the challenge: the pending code is gone, as after any five wrong codes.
    expect(kv.get('otp:challenge')).toBeUndefined();
    expect(await core.verify(lobby.code)).toMatchObject({ ok: false, error: 'otp_locked' });
  });

  it('with no pending challenge a closed purpose answers otp_wrong, as without one', async () => {
    const { core } = setup();
    expect(await core.verify('123456', ['manage'])).toEqual({ ok: false, error: 'otp_wrong' });
  });

  it('a manage issue replaces a pending lobby code (one challenge per invitation)', async () => {
    const { core, clock } = setup();
    const lobby = issued(await core.issue('lobby'));
    clock.ms += RESEND_AFTER_MS;
    const manage = issued(await core.issue('manage'));
    if (lobby.code !== manage.code) {
      expect(await core.verify(lobby.code)).toEqual({ ok: false, error: 'otp_wrong' });
    }
    expect(verifiedNonce(await core.verify(manage.code)).purpose).toBe('manage');
  });
});

const methods = (h: Harness) => h.calls.map((c) => c.method);

const requestCode = async (h: Harness, purpose?: 'lobby' | 'manage') => {
  const res = await h.request('POST', '/v1/otp/request', {
    json: purpose === undefined ? { token: LINK() } : { token: LINK(), purpose },
  });
  expect(res.status).toBe(200);
  return h.codes().at(-1) ?? '';
};

const verifyCode = (h: Harness, code: string, extra: Record<string, unknown> = {}) =>
  h.request('POST', '/v1/otp/verify', { json: { token: LINK(), code, ...extra } });

describe('otp routes: the purpose decides the mint (R5-19, AT-M2-34)', () => {
  it('a request without a purpose sends the lobby copy and mints a lobby token (the D1 app keeps working)', async () => {
    const h = await createHarness();
    const code = await requestCode(h);
    const send = h.calls.find((c) => c.method === 'messagingSend');
    expect(send?.input.purpose).toBe('lobby');
    const res = await verifyCode(h, code);
    expect(res.status).toBe(200);
    OtpVerifyRes.parse(await res.json());
    expect(methods(h)).toContain('lobbyMint');
    expect(methods(h)).not.toContain('portalMint');
  });

  it('a manage request sends the manage copy; its code mints a portal token only, never a lobby token', async () => {
    const h = await createHarness();
    const code = await requestCode(h, 'manage');
    const send = h.calls.find((c) => c.method === 'messagingSend');
    expect(send?.input.purpose).toBe('manage');
    const res = await verifyCode(h, code);
    expect(res.status).toBe(200);
    const body = OtpVerifyPortalRes.parse(await res.json());
    expect(body).not.toHaveProperty('lobbyToken');
    expect(methods(h)).not.toContain('lobbyMint');
    const mint = h.calls.find((c) => c.method === 'portalMint');
    expect(Object.keys(mint?.input ?? {}).sort()).toEqual(['invitationId', 'nonce', 'orgId']);
    expect(mint?.input.invitationId).toBe(INVITATION);
    // The nonce api put in the portal token is the one whose hash the object holds under the portal key.
    expect(h.otp.kvs.get(INVITATION)?.get('portal:nonce_hash')).toBe(
      await sha256Hex(String(mint?.input.nonce)),
    );
    expect(h.otp.kvs.get(INVITATION)?.get('lobby:nonce_hash')).toBeUndefined();
  });

  it('a purpose sent at verify is refused by the strict parse (400) and the code stays usable', async () => {
    const h = await createHarness();
    const code = await requestCode(h, 'manage');
    for (const purpose of ['lobby', 'manage']) {
      const res = await verifyCode(h, code, { purpose });
      expect(res.status).toBe(400);
    }
    expect(methods(h)).not.toContain('lobbyMint');
    expect(methods(h)).not.toContain('portalMint');
    const res = await verifyCode(h, code);
    expect(res.status).toBe(200);
    OtpVerifyPortalRes.parse(await res.json());
  });

  it('an unknown purpose is 400 before anything is called', async () => {
    const h = await createHarness();
    const res = await h.request('POST', '/v1/otp/request', {
      json: { token: LINK(), purpose: 'invite' },
    });
    expect(res.status).toBe(400);
    expect(h.calls).toEqual([]);
    expect(h.otp.names).toEqual([]);
  });

  it('a manage login never supersedes the lobby token, and a new lobby login never kills the portal token', async () => {
    const h = await createHarness();
    const lobby = await h.login();
    h.clock.ms += RESEND_AFTER_MS;
    const portal = await h.loginPortal();
    expect((await h.request('GET', '/v1/lobby/notice', { token: lobby })).status).toBe(200);
    expect((await h.request('GET', '/v1/portal/slots', { token: portal })).status).toBe(200);

    h.clock.ms += RESEND_AFTER_MS;
    const lobby2 = await h.login();
    const stale = await h.request('GET', '/v1/lobby/notice', { token: lobby });
    expect(stale.status).toBe(401);
    expect(await stale.json()).toEqual({ error: 'superseded' });
    expect((await h.request('GET', '/v1/lobby/notice', { token: lobby2 })).status).toBe(200);
    expect((await h.request('GET', '/v1/portal/slots', { token: portal })).status).toBe(200);
  });

  it('a new manage login supersedes the older portal token only', async () => {
    const h = await createHarness();
    const portal = await h.loginPortal();
    h.clock.ms += RESEND_AFTER_MS;
    const portal2 = await h.loginPortal();
    const stale = await h.request('GET', '/v1/portal/slots', { token: portal });
    expect(stale.status).toBe(401);
    expect(await stale.json()).toEqual({ error: 'superseded' });
    expect((await h.request('GET', '/v1/portal/slots', { token: portal2 })).status).toBe(200);
  });

  it('the route budget is shared: lobby, manage, lobby, then the fourth request is 429 and sends nothing', async () => {
    const h = await createHarness();
    await requestCode(h, 'lobby');
    h.clock.ms += RESEND_AFTER_MS;
    await requestCode(h, 'manage');
    h.clock.ms += RESEND_AFTER_MS;
    await requestCode(h);
    h.clock.ms += RESEND_AFTER_MS;
    const res = await h.request('POST', '/v1/otp/request', {
      json: { token: LINK(), purpose: 'manage' },
    });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(h.codes()).toHaveLength(3);
  });

  it('a portalMint failure answers its code; no lobby token is minted in its place', async () => {
    const h = await createHarness({
      portalMint: async () => {
        throw new Error('reschedule_used');
      },
    });
    const code = await requestCode(h, 'manage');
    const res = await verifyCode(h, code);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'reschedule_used' });
    expect(methods(h)).not.toContain('lobbyMint');
  });

  it('a portalMint answer carrying a lobby token is refused (503), never passed on', async () => {
    const h = await createHarness({
      portalMint: async () => ({
        portalToken: 'aaa.bbb.ccc',
        expiresAt: new Date(T0).toISOString(),
        lobbyToken: 'aaa.bbb.ccc',
      }),
    });
    const code = await requestCode(h, 'manage');
    const res = await verifyCode(h, code);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
  });
});
