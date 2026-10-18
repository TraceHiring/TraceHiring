// AT-D28 (specs/d1-demo-slice.md §4.2, §4.8 RT-6): InviteOtpDO. Attempts, lock, resend limits, expiry, lobby-nonce
// rotation; keyed by invitation, the code stored salted-hashed, a new challenge invalidates the old. The logic runs on
// a Map-backed fake of the object's KV (the test pool has no OTP binding); the routes run through the real app.
import { describe, expect, it } from 'vitest';
import { constantTimeEqual, sha256Hex } from './encoding.js';
import { createHarness, LINK, MapKv } from './edge.test-helpers.js';
import {
  CODE_TTL_MS,
  FAILURES_BEFORE_LOCK,
  LOCK_MS,
  OtpCore,
  RESEND_AFTER_MS,
  type IssueResult,
} from './otp-core.js';
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

/** A six-digit code that is not `code`. */
const wrong = (code: string): string => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('OtpCore issue (resend limits)', () => {
  it('issues a 6-digit code valid 10 minutes, resend after 30 s', async () => {
    const { core } = setup();
    const r = issued(await core.issue());
    expect(r.code).toMatch(/^[0-9]{6}$/);
    expect(r.expiresInSeconds).toBe(600);
    expect(r.resendAfterSeconds).toBe(30);
  });

  it('stores the code salted-hashed, never in clear', async () => {
    const { core, kv } = setup();
    const r = issued(await core.issue());
    const stored = JSON.stringify([...kv.map.entries()]);
    expect(stored).not.toContain(r.code);
    expect(stored).not.toContain(await sha256Hex(r.code));
  });

  it('refuses a resend within 30 s with resend_too_soon and the wait', async () => {
    const { core, clock } = setup();
    issued(await core.issue());
    clock.ms += 10_000;
    expect(await core.issue()).toEqual({
      ok: false,
      error: 'resend_too_soon',
      retryAfterSeconds: 20,
    });
    clock.ms += RESEND_AFTER_MS - 10_000;
    expect((await core.issue()).ok).toBe(true);
  });

  it('allows 3 codes per 10 minutes, then rate_limited until the oldest leaves the window', async () => {
    const { core, clock } = setup();
    for (let i = 0; i < 3; i += 1) {
      issued(await core.issue());
      clock.ms += 31_000;
    }
    const refused = await core.issue();
    expect(refused).toMatchObject({ ok: false, error: 'rate_limited' });
    expect(
      refused.ok === false && 'retryAfterSeconds' in refused && refused.retryAfterSeconds,
    ).toBe(600 - 93);
    clock.ms = T0 + 600_001;
    expect((await core.issue()).ok).toBe(true);
  });

  it('a new challenge invalidates the old code', async () => {
    // Injected randomness: the two codes are 111111 and 222222, so the assertion never depends on chance.
    const clock = { ms: T0 };
    const words = [111_111, 222_222];
    const core = new OtpCore(new MapKv(), {
      now: () => clock.ms,
      random: (bytes) => {
        if (bytes.length === 4) new DataView(bytes.buffer).setUint32(0, words.shift() ?? 0);
        else crypto.getRandomValues(bytes);
        return bytes;
      },
    });
    const first = issued(await core.issue());
    clock.ms += 31_000;
    const second = issued(await core.issue());
    expect([first.code, second.code]).toEqual(['111111', '222222']);
    expect(await core.verify(first.code)).toEqual({ ok: false, error: 'otp_wrong' });
    expect((await core.verify(second.code)).ok).toBe(true);
  });

  it('codes are uniform six-digit strings, including leading zeros', async () => {
    const words = [0xffff_ffff, 7, 0];
    const core = new OtpCore(new MapKv(), {
      now: () => T0,
      random: (bytes) => {
        if (bytes.length === 4) new DataView(bytes.buffer).setUint32(0, words.shift() ?? 1);
        return bytes;
      },
    });
    // 0xffffffff is above the unbiased limit and is drawn again; 7 gives "000007".
    expect(issued(await core.issue()).code).toBe('000007');
  });
});

describe('OtpCore verify (attempts, lock, expiry)', () => {
  it('a right code verifies once and returns a fresh nonce; a replay fails', async () => {
    const { core } = setup();
    const r = issued(await core.issue());
    const ok = await core.verify(r.code);
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.nonce.length).toBeGreaterThanOrEqual(16);
    expect(await core.verify(r.code)).toEqual({ ok: false, error: 'otp_wrong' });
  });

  it('allows 5 attempts per challenge, then locks for 15 minutes', async () => {
    const { core, clock } = setup();
    const r = issued(await core.issue());
    for (let i = 1; i < FAILURES_BEFORE_LOCK; i += 1) {
      expect(await core.verify(wrong(r.code))).toEqual({ ok: false, error: 'otp_wrong' });
    }
    expect(await core.verify(wrong(r.code))).toEqual({
      ok: false,
      error: 'otp_locked',
      retryAfterSeconds: 900,
      lockedNow: true,
    });
    // Locked: even the right code and a new request are refused, and only the attempt that locked says lockedNow.
    expect(await core.verify(r.code)).toEqual({
      ok: false,
      error: 'otp_locked',
      retryAfterSeconds: 900,
    });
    clock.ms += 60_000;
    expect(await core.issue()).toEqual({ ok: false, error: 'otp_locked', retryAfterSeconds: 840 });
    // After the lock a new code works; the old challenge is gone.
    clock.ms = T0 + LOCK_MS + 1;
    expect(await core.verify(r.code)).toEqual({ ok: false, error: 'otp_wrong' });
    const next = issued(await core.issue());
    expect((await core.verify(next.code)).ok).toBe(true);
  });

  it('failures count per invitation across codes: 4 wrong, +30 s, a new code, 1 wrong locks (SEC-3)', async () => {
    const { core, clock } = setup();
    const a = issued(await core.issue());
    for (let i = 0; i < 4; i += 1) {
      expect(await core.verify(wrong(a.code))).toEqual({ ok: false, error: 'otp_wrong' });
    }
    clock.ms += 30_000;
    const b = issued(await core.issue());
    expect(await core.verify(wrong(b.code))).toMatchObject({
      ok: false,
      error: 'otp_locked',
      retryAfterSeconds: 900,
    });
    expect(await core.verify(b.code)).toMatchObject({ ok: false, error: 'otp_locked' });
  });

  it('a correct code resets the failure count (SEC-3)', async () => {
    const { core, clock } = setup();
    const a = issued(await core.issue());
    for (let i = 0; i < 4; i += 1) await core.verify(wrong(a.code));
    expect((await core.verify(a.code)).ok).toBe(true);
    clock.ms += 31_000;
    const b = issued(await core.issue());
    for (let i = 0; i < 4; i += 1) {
      expect(await core.verify(wrong(b.code))).toEqual({ ok: false, error: 'otp_wrong' });
    }
    expect(await core.verify(wrong(b.code))).toMatchObject({ ok: false, error: 'otp_locked' });
  });

  it('the end of a lock starts a fresh count of 5 (SEC-3)', async () => {
    const { core, clock } = setup();
    const a = issued(await core.issue());
    for (let i = 0; i < FAILURES_BEFORE_LOCK; i += 1) await core.verify(wrong(a.code));
    clock.ms += LOCK_MS + 1;
    const b = issued(await core.issue());
    for (let i = 1; i < FAILURES_BEFORE_LOCK; i += 1) {
      expect(await core.verify(wrong(b.code))).toEqual({ ok: false, error: 'otp_wrong' });
    }
    expect((await core.verify(b.code)).ok).toBe(true);
  });

  it('a code expires after 10 minutes', async () => {
    const { core, clock } = setup();
    const r = issued(await core.issue());
    clock.ms += CODE_TTL_MS;
    expect(await core.verify(r.code)).toEqual({ ok: false, error: 'otp_wrong' });
  });

  it('a code is valid just before expiry', async () => {
    const { core, clock } = setup();
    const r = issued(await core.issue());
    clock.ms += CODE_TTL_MS - 1;
    expect((await core.verify(r.code)).ok).toBe(true);
  });

  it('verify without a challenge, or with a malformed code, is otp_wrong and counts nothing', async () => {
    const { core } = setup();
    expect(await core.verify('123456')).toEqual({ ok: false, error: 'otp_wrong' });
    const r = issued(await core.issue());
    for (const bad of ['12345', '1234567', 'abcdef', '']) {
      expect(await core.verify(bad)).toEqual({ ok: false, error: 'otp_wrong' });
    }
    expect((await core.verify(r.code)).ok).toBe(true);
  });

  it('concurrent wrong guesses are all counted (no lost update)', async () => {
    const { core } = setup();
    const r = issued(await core.issue());
    const results = await Promise.all(Array.from({ length: 8 }, () => core.verify(wrong(r.code))));
    expect(results.filter((x) => !x.ok && x.error === 'otp_locked').length).toBeGreaterThan(0);
    expect(await core.verify(r.code)).toMatchObject({ ok: false, error: 'otp_locked' });
  });

  it('constantTimeEqual compares exactly', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'ab')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

describe('OtpCore lobby nonce and limits', () => {
  const login = async (core: OtpCore): Promise<string> => {
    const r = issued(await core.issue());
    const v = await core.verify(r.code);
    if (!v.ok) throw new Error('verify failed');
    return v.nonce;
  };

  it('a verify rotates the nonce: the old one is superseded, the new one passes', async () => {
    const { core, clock } = setup();
    const first = await login(core);
    expect(await core.lobbyGate(first, 'age')).toEqual({ ok: true });
    clock.ms += 31_000;
    const second = await login(core);
    expect(second).not.toBe(first);
    expect(await core.lobbyGate(first, 'age')).toEqual({ ok: false, error: 'superseded' });
    expect(await core.lobbyGate(second, 'age')).toEqual({ ok: true });
  });

  it('stores only the nonce hash', async () => {
    const { core, kv } = setup();
    const n = await login(core);
    expect(JSON.stringify([...kv.map.entries()])).not.toContain(n);
  });

  it('no stored nonce, a cleared nonce or a malformed one is token_invalid', async () => {
    const { core } = setup();
    expect(await core.lobbyGate(nonce(), 'age')).toEqual({ ok: false, error: 'token_invalid' });
    const n = await login(core);
    expect(await core.lobbyGate('short', 'age')).toEqual({ ok: false, error: 'token_invalid' });
    core.clearLobbyNonce();
    expect(await core.lobbyGate(n, 'age')).toEqual({ ok: false, error: 'token_invalid' });
  });

  it('counts 10 per minute per route, then rate_limited with the wait; a stale token uses no budget', async () => {
    const { core, clock } = setup();
    const n = await login(core);
    for (let i = 0; i < 20; i += 1) await core.lobbyGate(nonce('stale'), 'notice');
    for (let i = 0; i < 10; i += 1) expect(await core.lobbyGate(n, 'notice')).toEqual({ ok: true });
    clock.ms += 15_000;
    expect(await core.lobbyGate(n, 'notice')).toEqual({
      ok: false,
      error: 'rate_limited',
      retryAfterSeconds: 45,
    });
    expect(await core.lobbyGate(n, 'consent')).toEqual({ ok: true });
    clock.ms += 45_000;
    expect(await core.lobbyGate(n, 'notice')).toEqual({ ok: true });
  });

  it('three photo slots per session', () => {
    const { core } = setup();
    expect(core.takePhotoSlot()).toEqual({ ok: true, n: 1 });
    expect(core.takePhotoSlot()).toEqual({ ok: true, n: 2 });
    expect(core.takePhotoSlot()).toEqual({ ok: true, n: 3 });
    expect(core.takePhotoSlot()).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('releasePhotoSlot gives back only the slot it names, once, never below zero (SEC-4)', () => {
    const { core } = setup();
    core.releasePhotoSlot(1); // nothing taken: no-op
    expect(core.takePhotoSlot()).toEqual({ ok: true, n: 1 });
    expect(core.takePhotoSlot()).toEqual({ ok: true, n: 2 });
    core.releasePhotoSlot(2);
    core.releasePhotoSlot(2); // a second release of the same slot changes nothing
    core.releasePhotoSlot(3); // a slot not taken: no-op
    expect(core.takePhotoSlot()).toEqual({ ok: true, n: 2 });
    expect(core.takePhotoSlot()).toEqual({ ok: true, n: 3 });
    expect(core.takePhotoSlot()).toEqual({ ok: false, error: 'rate_limited' });
    // Releasing an older slot while a later one is held frees exactly that one.
    core.releasePhotoSlot(1);
    expect(core.takePhotoSlot()).toEqual({ ok: true, n: 1 });
    expect(core.takePhotoSlot()).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('closePhotos is set-once: every later slot is refused closed, the cap reason no longer matters', () => {
    const { core, kv } = setup();
    expect(core.takePhotoSlot()).toEqual({ ok: true, n: 1 });
    core.closePhotos();
    expect(core.takePhotoSlot()).toEqual({ ok: false, error: 'closed' });
    core.closePhotos();
    expect(core.takePhotoSlot()).toEqual({ ok: false, error: 'closed' });
    // Closed with no slot used at all: still closed, and the refusal writes nothing.
    const fresh = setup();
    fresh.core.closePhotos();
    const before = JSON.stringify([...fresh.kv.map.entries()]);
    expect(fresh.core.takePhotoSlot()).toEqual({ ok: false, error: 'closed' });
    expect(JSON.stringify([...fresh.kv.map.entries()])).toBe(before);
    expect(kv.map.size).toBeGreaterThan(0);
  });
});

describe('invite and OTP routes', () => {
  it('resolve answers the state and display data only: no id, org or candidate', async () => {
    const h = await createHarness();
    const res = await h.request('POST', '/v1/invite/resolve', { json: { token: LINK() } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      state: 'sent',
      title: 'Demo assessment',
      durationMinutes: 20,
    });
    expect(h.calls.map((c) => c.method)).toEqual(['inviteResolve']);
    expect(h.otp.names).toEqual([]);
  });

  it.each([
    ['invalid_link', 404],
    ['link_expired', 410],
  ])('resolve maps api %s to %i', async (code, status) => {
    const h = await createHarness({
      inviteResolve: async () => {
        throw new Error(code);
      },
    });
    const res = await h.request('POST', '/v1/invite/resolve', { json: { token: LINK() } });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
  });

  it('otp/request issues in the invitation object and hands the code to api, not to the client', async () => {
    const h = await createHarness();
    const res = await h.request('POST', '/v1/otp/request', { json: { token: LINK() } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ resendAfterSeconds: 30, expiresInSeconds: 600, channel: 'email' });
    expect(h.otp.names).toEqual([INVITATION]);
    const send = h.calls.find((c) => c.method === 'messagingSend');
    expect(send?.input).toMatchObject({ invitationId: INVITATION });
    expect(String(send?.input.code)).toMatch(/^[0-9]{6}$/);
    expect(JSON.stringify(body)).not.toContain(String(send?.input.code));
  });

  it('a resend within 30 s answers 429 resend_too_soon with Retry-After, and sends nothing', async () => {
    const h = await createHarness();
    await h.request('POST', '/v1/otp/request', { json: { token: LINK() } });
    h.clock.ms += 5000;
    const res = await h.request('POST', '/v1/otp/request', { json: { token: LINK() } });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('25');
    expect(await res.json()).toEqual({ error: 'resend_too_soon' });
    expect(h.codes()).toHaveLength(1);
  });

  it.each([
    ['blocked_age', 403, 'not_eligible'],
    ['expired', 410, 'link_expired'],
    ['revoked', 410, 'link_revoked'],
  ])('a %s invitation gets no OTP: %i %s, no object, no message', async (state, status, code) => {
    const h = await createHarness({
      inviteResolve: async () => ({
        invitationId: INVITATION,
        orgId: '22222222-2222-4222-8222-222222222222',
        candidateId: '33333333-3333-4333-8333-333333333333',
        state,
      }),
    });
    for (const path of ['/v1/otp/request', '/v1/otp/verify']) {
      const json = path.endsWith('verify') ? { token: LINK(), code: '123456' } : { token: LINK() };
      const res = await h.request('POST', path, { json });
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: code });
    }
    expect(h.otp.names).toEqual([]);
    expect(h.calls.map((c) => c.method)).toEqual(['inviteResolve', 'inviteResolve']);
  });

  it('a messaging failure is 503 unavailable', async () => {
    const h = await createHarness({
      messagingSend: async () => {
        throw new Error('boom');
      },
    });
    const res = await h.request('POST', '/v1/otp/request', { json: { token: LINK() } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
  });

  it('verify with the right code mints a lobby token on the nonce whose hash the object holds', async () => {
    const h = await createHarness();
    await h.request('POST', '/v1/otp/request', { json: { token: LINK() } });
    const res = await h.request('POST', '/v1/otp/verify', {
      json: { token: LINK(), code: h.codes()[0] },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'lobbyToken', 'next']);
    const mint = h.calls.find((c) => c.method === 'lobbyMint');
    expect(mint?.input).toMatchObject({ invitationId: INVITATION });
    const core = h.otp.cores.get(INVITATION);
    expect(await core?.lobbyGate(String(mint?.input.nonce), 'age')).toEqual({ ok: true });
  });

  it('a wrong code is 401 otp_wrong; the fifth is 429 otp_locked with Retry-After 900', async () => {
    const h = await createHarness();
    await h.request('POST', '/v1/otp/request', { json: { token: LINK() } });
    const bad = wrong(h.codes()[0] ?? '000000');
    for (let i = 1; i < 5; i += 1) {
      const res = await h.request('POST', '/v1/otp/verify', { json: { token: LINK(), code: bad } });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'otp_wrong' });
    }
    const locked = await h.request('POST', '/v1/otp/verify', {
      json: { token: LINK(), code: bad },
    });
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).toBe('900');
    expect(await locked.json()).toEqual({ error: 'otp_locked' });
    expect(h.calls.some((c) => c.method === 'lobbyMint')).toBe(false);
  });

  it('otp.locked is logged once, by the attempt that locks; a 6th attempt logs nothing (SR-7)', async () => {
    const h = await createHarness();
    await h.request('POST', '/v1/otp/request', { json: { token: LINK() } });
    const bad = wrong(h.codes()[0] ?? '000000');
    const verify = () =>
      h.request('POST', '/v1/otp/verify', { json: { token: LINK(), code: bad } });
    for (let i = 1; i < 5; i += 1) await verify();
    expect(h.lines).toEqual([]);
    expect((await verify()).status).toBe(429);
    expect(h.lines.map((l) => (JSON.parse(l) as { event: string }).event)).toEqual(['otp.locked']);
    const sixth = await verify();
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual({ error: 'otp_locked' });
    expect(h.lines).toHaveLength(1);
  });

  it('a malformed code or an unknown key is 400 before anything is called', async () => {
    const h = await createHarness();
    for (const json of [
      { token: LINK(), code: '12345' },
      { token: LINK(), code: '123456', extra: true },
      { token: 'short', code: '123456' },
    ]) {
      const res = await h.request('POST', '/v1/otp/verify', { json });
      expect(res.status).toBe(400);
    }
    expect(h.calls).toEqual([]);
  });

  it('the object id is the api-resolved invitation, never an id from the body', async () => {
    const h = await createHarness();
    await h.request('POST', '/v1/otp/request', {
      json: { token: LINK(), invitationId: '99999999-9999-4999-8999-999999999999' },
    });
    expect(h.otp.names).toEqual([INVITATION]);
  });

  it('a missing OTP binding fails closed with 503', async () => {
    const h = await createHarness();
    const env = { ...h.env, OTP: undefined } as unknown as Env;
    const { createApp } = await import('./app.js');
    const res = await createApp().request(
      'https://edge.test/v1/otp/request',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: LINK() }),
      },
      env,
    );
    expect(res.status).toBe(503);
  });
});
