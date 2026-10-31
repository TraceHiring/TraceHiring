// AT-M2-09 (edge part) and AT-M2-25 (edge verifier part), specs/m2-scheduling-invites.md M2-9, R5-19, R5-23, R5-53,
// R5-63, R5-64, R5-66, §6.5, E12, E13. Drive rows: an OTP with purpose `lobby` is refused (409 `lobby_closed`) before
// the lobby opens and after `na` for an invitation not yet started, and allowed for a started one until
// `session_grant_exp`; the edge refuses on api's own phase before any code is issued (so no send budget is used), and
// api's refusals reach the client as is. `SessionDO.start` refuses a first start before `nb` and after `na` by its own
// clock (409 `outside_start_window`), whatever the client's clock says; a resume, also after a lost DO, ignores `sw`.
// `invite/resolve` copies `schedule` field by field. The lobby verifier cap is 5,460 s. Fakes stand for stream B2's api.
import { InviteResolveRes } from '@trace/shared/contracts/candidate';
import { describe, expect, it } from 'vitest';
import { createHarness, LINK, NOW_MS } from './edge.test-helpers.js';
import {
  coreHarness,
  driveHarness,
  LOBBY_DRIVE_CAP_SECONDS,
  startInput,
  type DriveHarness,
} from './session.test-helpers.js';
import { INVITATION, signToken, lobbyClaims } from './token.test-helpers.js';

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

const otpRequest = (h: DriveHarness, purpose?: 'lobby' | 'manage') =>
  h.request('POST', '/v1/otp/request', {
    json: purpose === undefined ? { token: LINK() } : { token: LINK(), purpose },
  });

const otpMethods = (h: DriveHarness) => h.otp.calls.map((c) => c.method);
const apiCalls = (h: DriveHarness, method: string) => h.calls.filter((c) => c.method === method);

describe('drive rows: OTP purpose `lobby` only inside the lobby window (R5-19, R5-53, AT-M2-09)', () => {
  it('before the lobby opens: 409 lobby_closed, no code issued, nothing sent (E12 wait_lobby)', async () => {
    const h = await driveHarness();
    expect(h.clock.ms).toBeLessThan(h.lobbyOpensAt());
    const res = await otpRequest(h);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'lobby_closed' });
    expect(otpMethods(h)).not.toContain('issue');
    expect(apiCalls(h, 'messagingSend')).toEqual([]);
    // With no code issued there is nothing to verify, and nothing is minted.
    const verify = await h.request('POST', '/v1/otp/verify', {
      json: { token: LINK(), code: '123456' },
    });
    expect(verify.status).toBe(401);
    expect(apiCalls(h, 'lobbyMint')).toEqual([]);
  });

  it('inside the lobby: the code is sent with purpose lobby and sessionLive false, and the token is minted', async () => {
    const h = await driveHarness();
    h.clock.ms = h.lobbyOpensAt();
    const lobby = await h.login();
    expect(lobby).toMatch(/\./);
    expect(apiCalls(h, 'messagingSend')[0]?.input).toMatchObject({
      purpose: 'lobby',
      sessionLive: false,
    });
    expect(apiCalls(h, 'lobbyMint')[0]?.input).toMatchObject({ sessionLive: false });
    expect(h.session.peeks.length).toBeGreaterThanOrEqual(2);
    // A peek reads only: no session exists after the login.
    expect(h.session.sessions.get(INVITATION)?.kv.map.size ?? 0).toBe(0);
  });

  it('after na, not started: 409 lobby_closed at request and at verify, no code issued (E12 window_missed)', async () => {
    const h = await driveHarness();
    h.clock.ms = h.na() + 1000;
    const res = await otpRequest(h);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'lobby_closed' });
    expect(otpMethods(h)).not.toContain('issue');
    expect(apiCalls(h, 'messagingSend')).toEqual([]);
  });

  it('the window closing between request and verify: verify is 409 lobby_closed, nothing consumed or counted', async () => {
    const h = await driveHarness();
    h.clock.ms = h.na() - 2 * MIN; // the code (valid 10 min) is still live when the window closes
    expect((await otpRequest(h)).status).toBe(200);
    const code = h.codes().at(-1) ?? '';
    const kv = h.otp.kvs.get(INVITATION);
    const challenge = kv?.get('otp:challenge');
    h.clock.ms = h.na() + 1000;
    const verify = await h.request('POST', '/v1/otp/verify', { json: { token: LINK(), code } });
    expect(verify.status).toBe(409);
    expect(await verify.json()).toEqual({ error: 'lobby_closed' });
    expect(apiCalls(h, 'lobbyMint')).toEqual([]);
    expect(kv?.get('otp:challenge')).toEqual(challenge);
    expect(kv?.get('otp:failures')).toBeUndefined();
    expect(kv?.get('lobby:nonce_hash')).toBeUndefined();
  });

  it('after a missed window a pending manage code still verifies (only `lobby` is closed)', async () => {
    const h = await driveHarness();
    h.clock.ms = h.na() + MIN;
    expect((await otpRequest(h, 'manage')).status).toBe(200);
    const code = h.codes().at(-1) ?? '';
    const verify = await h.request('POST', '/v1/otp/verify', { json: { token: LINK(), code } });
    expect(verify.status).toBe(200);
    expect(await verify.json()).toHaveProperty('portalToken');
  });

  it('an api lobby_closed refusal at mint reaches the client as 409 lobby_closed', async () => {
    const h = await driveHarness();
    h.clock.ms = h.lobbyOpensAt() + MIN;
    expect((await otpRequest(h)).status).toBe(200);
    const code = h.codes().at(-1) ?? '';
    const api = h.env.API as unknown as Record<string, (i: unknown) => Promise<unknown>>;
    api.lobbyMint = async () => {
      throw new Error('lobby_closed');
    };
    const verify = await h.request('POST', '/v1/otp/verify', { json: { token: LINK(), code } });
    expect(verify.status).toBe(409);
    expect(await verify.json()).toEqual({ error: 'lobby_closed' });
  });

  it('api refuses at send although the edge saw the lobby open (api decides): 409 reaches the client', async () => {
    const h = await driveHarness();
    h.clock.ms = h.lobbyOpensAt() + MIN;
    const api = h.env.API as unknown as Record<string, (i: unknown) => Promise<unknown>>;
    api.messagingSend = async () => {
      throw new Error('lobby_closed');
    };
    const res = await otpRequest(h);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'lobby_closed' });
  });

  it('a started row may use the lobby OTP after na until session_grant_exp, then lobby_closed (R5-53)', async () => {
    const h = await driveHarness({ state: 'started' });
    h.clock.ms = h.na() + 10 * MIN;
    h.drive.sessionGrantExp = h.clock.ms + 5 * MIN;
    expect(await h.login()).toMatch(/\./);
    h.clock.ms = h.drive.sessionGrantExp + 1000;
    const res = await otpRequest(h);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'lobby_closed' });
  });

  it('a manage OTP is not refused by the lobby window at the edge (the missed window offers a reschedule)', async () => {
    const h = await driveHarness();
    h.clock.ms = h.na() + MIN;
    const portal = await h.loginPortal();
    expect(portal).toMatch(/\./);
    expect(apiCalls(h, 'portalMint')).toHaveLength(1);
  });

  it('a D1 row (no schedule) keeps the D1 path: no peek and no sessionLive at request or verify', async () => {
    const h = await createHarness();
    await h.login();
    expect(h.session.peeks).toEqual([]);
    for (const method of ['messagingSend', 'lobbyMint']) {
      const call = h.calls.find((c) => c.method === method);
      expect(call?.input).not.toHaveProperty('sessionLive');
    }
  });
});

describe('SessionDO.start re-checks sw by its own clock when it creates the session (R5-63, AT-M2-09)', () => {
  const window = (h: { clock: { ms: number } }) => ({
    nb: iso(h.clock.ms + 10 * MIN),
    na: iso(h.clock.ms + 25 * MIN),
  });

  it('refuses a first start before nb and after na with outside_start_window and stores nothing', async () => {
    for (const offset of [-1, 15 * MIN + 1]) {
      const h = await coreHarness();
      const sw = window(h);
      h.clock.ms = Date.parse(sw.nb) + offset;
      const out = await h.core.start(startInput(h.sha256, { sw }));
      expect(out).toEqual({ ok: false, error: 'outside_start_window' });
      expect(h.kv.map.size).toBe(0);
      expect(h.alarm.at).toBeNull();
    }
  });

  it('accepts a first start at nb, inside, and at na exactly', async () => {
    for (const at of ['nb', 'mid', 'na'] as const) {
      const h = await coreHarness();
      const sw = window(h);
      h.clock.ms =
        at === 'nb' ? Date.parse(sw.nb) : at === 'na' ? Date.parse(sw.na) : Date.parse(sw.nb) + MIN;
      const out = await h.core.start(startInput(h.sha256, { sw }));
      expect({ at, ok: out.ok }).toEqual({ at, ok: true });
    }
  });

  it('a resume after na (meta present) never checks sw', async () => {
    const h = await coreHarness();
    const sw = window(h);
    h.clock.ms = Date.parse(sw.nb) + MIN;
    const first = await h.core.start(startInput(h.sha256, { sw }));
    if (!first.ok) throw new Error('first start refused');
    h.clock.ms = Date.parse(sw.na) + 5 * MIN;
    const again = await h.core.start(
      startInput(h.sha256, { sw, nonce: 'session-nonce-0002-abcdef' }),
    );
    expect(again).toMatchObject({ ok: true, kind: 'live', startedAt: first.startedAt });
  });

  it('a resume after a lost DO (re-created from the stored start) never checks sw', async () => {
    const h = await coreHarness();
    const startedAt = iso(h.clock.ms);
    const sw = { nb: iso(h.clock.ms - MIN), na: iso(h.clock.ms + 14 * MIN) };
    h.clock.ms = Date.parse(sw.na) + 2 * MIN;
    const out = await h.core.start(startInput(h.sha256, { grantStartedAt: startedAt, sw }));
    expect(out).toMatchObject({ ok: true, kind: 'live', startedAt });
  });

  it('a D1 row (no sw) starts at any time, as before', async () => {
    const h = await coreHarness();
    h.clock.ms = NOW_MS + 7 * 24 * 60 * MIN;
    expect((await h.core.start(startInput(h.sha256))).ok).toBe(true);
  });

  it('through the route: api clock skewed, the DO refuses before nb; the client clock is ignored (E13)', async () => {
    const h = await driveHarness();
    h.api.checkWindow = false; // api's check passes (skewed), so the DO's own check is the one seen
    h.clock.ms = h.lobbyOpensAt() + MIN;
    const lobby = await h.login();
    const res = await h.request('POST', '/v1/session/start', {
      token: lobby,
      json: { rulesAcknowledged: true, photo: { skippedReason: 'declined' } },
      headers: { date: new Date(h.nb() + MIN).toUTCString() },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'outside_start_window' });
    expect(apiCalls(h, 'sessionStarted')).toEqual([]);
    expect(h.session.sessions.get(INVITATION)?.kv.get('meta')).toBeUndefined();
    // The lobby token stays alive: inside the window the same token starts the session.
    h.clock.ms = h.nb() + MIN;
    const ok = await h.request('POST', '/v1/session/start', {
      token: lobby,
      json: { rulesAcknowledged: true, photo: { skippedReason: 'declined' } },
    });
    expect(ok.status).toBe(200);
  });
});

describe('invite/resolve copies schedule field by field (R5-23, R5-64 b)', () => {
  const resolve = async (h: { request: DriveHarness['request'] }) => {
    const res = await h.request('POST', '/v1/invite/resolve', { json: { token: LINK() } });
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  };

  it('a D1 row answers no schedule key', async () => {
    const body = await resolve(await createHarness());
    expect(body).not.toHaveProperty('schedule');
    expect(Object.keys(body).sort()).toEqual(['durationMinutes', 'state', 'title']);
  });

  it('a drive row before the start answers its schedule exactly, and nothing else', async () => {
    const h = await driveHarness();
    const body = InviteResolveRes.parse(await resolve(h));
    expect(body.schedule).toEqual({
      mode: 'scheduled',
      phase: 'wait_lobby',
      slotStartsAt: iso(h.drive.slotStartsAt),
      lobbyOpensAt: iso(h.lobbyOpensAt()),
      startWindowEndsAt: iso(h.na()),
    });
    expect(Object.keys(body).sort()).toEqual(['durationMinutes', 'schedule', 'state', 'title']);
    h.clock.ms = h.na() + MIN;
    expect(((await resolve(h)).schedule as { phase: string }).phase).toBe('window_missed');
  });

  it('a schedule with only some times answers only those; a null schedule stays null', async () => {
    const partial = await createHarness({
      inviteResolve: async () => ({
        invitationId: INVITATION,
        orgId: INVITATION,
        candidateId: INVITATION,
        state: 'sent',
        schedule: { mode: 'open_window', phase: 'lobby_open', deadlineAt: iso(NOW_MS + MIN) },
      }),
    });
    expect((await resolve(partial)).schedule).toEqual({
      mode: 'open_window',
      phase: 'lobby_open',
      deadlineAt: iso(NOW_MS + MIN),
    });
    const nulled = await createHarness({
      inviteResolve: async () => ({
        invitationId: INVITATION,
        orgId: INVITATION,
        candidateId: INVITATION,
        state: 'started',
        schedule: null,
      }),
    });
    expect(await resolve(nulled)).toEqual({ state: 'started', schedule: null });
  });

  it('a started row answers schedule null (never window_missed after the start)', async () => {
    const h = await driveHarness({ state: 'started' });
    h.clock.ms = h.na() + MIN;
    expect((await resolve(h)).schedule).toBeNull();
  });

  it('an api schedule with an extra field (a seat count) is refused (503), never passed on (rule 5)', async () => {
    const h = await createHarness({
      inviteResolve: async () => ({
        invitationId: INVITATION,
        orgId: INVITATION,
        candidateId: INVITATION,
        state: 'sent',
        schedule: { mode: 'scheduled', phase: 'lobby_open', seatsLeft: 3 },
      }),
    });
    const res = await h.request('POST', '/v1/invite/resolve', { json: { token: LINK() } });
    expect(res.status).toBe(503);
  });
});

describe('the lobby verifier cap is 5,460 s (R5-66 f, AT-M2-25 edge part)', () => {
  it('a lobby token of exactly 5,460 s passes a lobby route; 5,461 s is 401 token_invalid', async () => {
    const h = await createHarness();
    await h.login();
    const nonce = String(h.calls.find((c) => c.method === 'lobbyMint')?.input.nonce);
    const now = Math.floor(h.clock.ms / 1000);
    const atCap = await signToken(
      h.key,
      lobbyClaims(now, { nonce, exp: now + LOBBY_DRIVE_CAP_SECONDS }),
    );
    expect((await h.request('GET', '/v1/lobby/notice', { token: atCap })).status).toBe(200);
    const over = await signToken(
      h.key,
      lobbyClaims(now, { nonce, exp: now + LOBBY_DRIVE_CAP_SECONDS + 1 }),
    );
    const res = await h.request('GET', '/v1/lobby/notice', { token: over });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'token_invalid' });
  });
});
