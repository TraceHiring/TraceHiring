// AT-M2-10 and AT-M2-36 (edge part), specs/m2-scheduling-invites.md R5-63, R5-66 (b, c), M2-9, §6.5: the start path
// stays D1's for every invitation (lobby token → POST /v1/session/start → api `sessionGrant` → `SessionDO.start` →
// awaited `sessionStarted`). Before the grant the edge peeks the invitation's SessionDO (read only) and passes
// `sessionLive`. The start makes no OTP `issue`/`verify` and no `messagingSend` call. A drive row starts with its lobby
// token inside the window and is refused outside it (api and DO); a lobby token minted at the lobby's first minute is
// still valid at `na`; a started row resumes with a fresh lobby token (no `sw` check, also after a lost DO); a reload,
// a device switch, an open-window return and a return after a reschedule all reach the start through OTP → lobby
// token; a session created at `na − 10 s` whose `sessionStarted` failed resumes after `na` through the peek; a
// submitted row re-entering start gets its receipt. Fakes stand for stream B2's api; synthetic data only.
import { InviteResolveRes, OkRes, SessionStartRes } from '@trace/shared/contracts/candidate';
import { describe, expect, it } from 'vitest';
import { LINK, NOTICE_ID, NOTICE_SHA, SLOT_A } from './edge.test-helpers.js';
import {
  coreHarness,
  driveHarness,
  sessionHarness,
  startInput,
  type DriveHarness,
  type SessionRouteHarness,
} from './session.test-helpers.js';
import { INVITATION } from './token.test-helpers.js';

const MIN = 60_000;
const startBody = { rulesAcknowledged: true, photo: { skippedReason: 'declined' } };

const start = (h: SessionRouteHarness, lobby: string) =>
  h.request('POST', '/v1/session/start', { token: lobby, json: startBody });

const apiCalls = (h: SessionRouteHarness, method: string) =>
  h.calls.filter((c) => c.method === method);

const meta = (h: SessionRouteHarness) =>
  h.session.sessions.get(INVITATION)?.kv.get<{ startedAt: number; state: string }>('meta');

/**
 * A first start at `na − 10 s` that the DO accepts but whose `sessionStarted` fails (503): the object holds a live
 * session while api still holds a not-started row. Returns the DO's `startedAt`; `sessionStarted` works again after.
 */
const failedStartAtNaMinus10s = async (h: DriveHarness): Promise<number | undefined> => {
  h.drive.failStarted = true;
  const lobby = await lobbyThen(h, h.lobbyOpensAt() + MIN);
  h.clock.ms = h.na() - 10_000;
  const failed = await start(h, lobby);
  expect(failed.status).toBe(503);
  expect(h.drive.state).toBe('otp_verified');
  h.drive.failStarted = false;
  return meta(h)?.startedAt;
};

/** Logs in inside the lobby and moves the clock to `at` (default: one minute into the window). */
const lobbyThen = async (h: DriveHarness, at?: number) => {
  h.clock.ms = h.lobbyOpensAt() + MIN;
  const lobby = await h.login();
  h.clock.ms = at ?? h.nb() + MIN;
  return lobby;
};

describe('consent keeps D1 (R5-63)', () => {
  it('consent answers D1 OkRes for a drive row and a D1 row', async () => {
    for (const h of [await driveHarness(), await sessionHarness()]) {
      if ('drive' in h) h.clock.ms = (h as DriveHarness).lobbyOpensAt() + MIN;
      const lobby = await h.login();
      const res = await h.request('POST', '/v1/lobby/consent', {
        token: lobby,
        json: { noticeVersionId: NOTICE_ID, renderedSha256: NOTICE_SHA, accepted: true },
      });
      expect(res.status).toBe(200);
      expect(OkRes.parse(await res.json())).toEqual({ ok: true });
    }
  });
});

describe('the start of a drive row (R5-63, AT-M2-36)', () => {
  it('starts with its lobby token inside the window; the grant got sessionLive false and carried sw', async () => {
    const h = await driveHarness();
    const lobby = await lobbyThen(h);
    const res = await start(h, lobby);
    expect(res.status).toBe(200);
    const body = SessionStartRes.parse(await res.json());
    expect(body).toHaveProperty('sessionToken');
    expect(apiCalls(h, 'sessionGrant')[0]?.input).toMatchObject({ sessionLive: false });
    expect(meta(h)?.startedAt).toBe(h.nb() + MIN);
    expect(h.drive.state).toBe('started');
  });

  it.each([
    ['before nb', (h: DriveHarness) => h.nb() - 1000],
    ['after na', (h: DriveHarness) => h.na() + 1000],
  ])('api refuses a first start %s: 409 outside_start_window, no DO start', async (_l, at) => {
    const h = await driveHarness();
    const lobby = await lobbyThen(h, h.lobbyOpensAt() + MIN);
    h.clock.ms = at(h);
    const res = await start(h, lobby);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'outside_start_window' });
    expect(h.session.names).toEqual([]);
    expect(apiCalls(h, 'sessionStarted')).toEqual([]);
  });

  it('the DO refuses a first start outside sw by its own clock when api let it through', async () => {
    const h = await driveHarness();
    h.api.checkWindow = false;
    const lobby = await lobbyThen(h, h.lobbyOpensAt() + MIN);
    h.clock.ms = h.na() + 1000;
    const res = await start(h, lobby);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'outside_start_window' });
    expect(meta(h)).toBeUndefined();
    expect(apiCalls(h, 'sessionStarted')).toEqual([]);
  });

  it('a lobby token minted at the lobby first minute (60 min early, 30 min window) is still valid at na', async () => {
    const h = await driveHarness({ lobbyOpensMinutes: 60, windowMinutes: 30 });
    h.clock.ms = h.lobbyOpensAt();
    const lobby = await h.login();
    h.clock.ms = h.na();
    const res = await start(h, lobby);
    expect(res.status).toBe(200);
    // Past na + 60 s the same token has expired (the mint-side cap, R5-63).
    const h2 = await driveHarness({ lobbyOpensMinutes: 60, windowMinutes: 30 });
    h2.clock.ms = h2.lobbyOpensAt();
    const lobby2 = await h2.login();
    h2.clock.ms = h2.na() + 60_000;
    const late = await start(h2, lobby2);
    expect(late.status).toBe(401);
    expect(await late.json()).toEqual({ error: 'token_expired' });
  });
});

describe('no OTP load in the start minute (AT-M2-10)', () => {
  it('the start request makes no OTP issue/verify and no messagingSend; api sees sessionGrant then sessionStarted', async () => {
    const h = await driveHarness();
    const lobby = await lobbyThen(h);
    const otpBefore = h.otp.calls.length;
    const apiBefore = h.calls.length;
    const sessionBefore = h.session.calls.length;
    const res = await start(h, lobby);
    expect(res.status).toBe(200);

    const otp = h.otp.calls.slice(otpBefore).map((c) => c.method);
    expect(otp).not.toContain('issue');
    expect(otp).not.toContain('verify');
    expect(otp).toEqual(['lobbyGate', 'closePhotos', 'clearLobbyNonce']);
    expect(h.calls.slice(apiBefore).map((c) => c.method)).toEqual([
      'sessionGrant',
      'sessionStarted',
    ]);
    expect(h.session.calls.slice(sessionBefore).map((c) => c.method)).toEqual(['peek', 'start']);
  });

  it('a D1 row start makes no OTP issue/verify and no messagingSend either', async () => {
    const h = await sessionHarness();
    const lobby = await h.login();
    const otpBefore = h.otp.calls.length;
    const apiBefore = h.calls.length;
    expect((await start(h, lobby)).status).toBe(200);
    const otp = h.otp.calls.slice(otpBefore).map((c) => c.method);
    expect(otp.filter((m) => m === 'issue' || m === 'verify')).toEqual([]);
    expect(h.calls.slice(apiBefore).map((c) => c.method)).toEqual([
      'sessionGrant',
      'sessionStarted',
    ]);
  });
});

describe('resume, reload, device switch and returns reach the start through OTP → lobby token (AT-M2-36)', () => {
  it('a started row resumes after na with a fresh lobby token: no sw in the grant, same startedAt', async () => {
    const h = await driveHarness();
    const first = await start(h, await lobbyThen(h));
    expect(first.status).toBe(200);
    const startedAt = meta(h)?.startedAt;
    h.clock.ms = h.na() + 2 * MIN;
    h.drive.sessionGrantExp = h.clock.ms + 30 * MIN;
    const lobby = await h.login();
    const res = await start(h, lobby);
    expect(res.status).toBe(200);
    expect(meta(h)?.startedAt).toBe(startedAt);
    const grants = apiCalls(h, 'sessionGrant');
    expect(grants).toHaveLength(2);
    expect(grants[1]?.input).toMatchObject({ sessionLive: true });
  });

  it('a resume after a lost DO re-creates the session from the stored start, after na, without a sw check', async () => {
    const h = await driveHarness();
    expect((await start(h, await lobbyThen(h))).status).toBe(200);
    const startedAt = meta(h)?.startedAt;
    h.session.sessions.delete(INVITATION);
    h.clock.ms = h.na() + 2 * MIN;
    h.drive.sessionGrantExp = h.clock.ms + 30 * MIN;
    const res = await start(h, await h.login());
    expect(res.status).toBe(200);
    expect(meta(h)?.startedAt).toBe(startedAt);
    expect(apiCalls(h, 'sessionGrant')[1]?.input).toMatchObject({ sessionLive: false });
  });

  it('a device switch before the start: the newer login starts; the older lobby token is superseded (D1)', async () => {
    const h = await driveHarness();
    h.clock.ms = h.lobbyOpensAt() + MIN;
    const older = await h.login();
    h.clock.ms += 30_000;
    const newer = await h.login();
    h.clock.ms = h.nb() + MIN;
    const stale = await start(h, older);
    expect(stale.status).toBe(401);
    expect(await stale.json()).toEqual({ error: 'superseded' });
    expect((await start(h, newer)).status).toBe(200);
  });

  it('a reload keeps the lobby token: the same token starts without a second OTP', async () => {
    const h = await driveHarness();
    const lobby = await lobbyThen(h);
    const sends = apiCalls(h, 'messagingSend').length;
    expect((await h.request('GET', '/v1/lobby/notice', { token: lobby })).status).toBe(200);
    expect((await start(h, lobby)).status).toBe(200);
    expect(apiCalls(h, 'messagingSend')).toHaveLength(sends);
  });

  it('an open-window return hours later: OTP again, then the start', async () => {
    const h = await driveHarness({
      mode: 'open_window',
      lobbyOpensMinutes: 0,
      windowMinutes: 3 * 24 * 60,
    });
    h.clock.ms = h.nb() + MIN;
    await h.login();
    h.clock.ms += 5 * 60 * MIN;
    const lobby = await h.login();
    expect((await start(h, lobby)).status).toBe(200);
  });

  it('a return after a missed window and a reschedule: lobby_closed, manage OTP, reschedule, then OTP and start', async () => {
    const h = await driveHarness();
    h.clock.ms = h.na() + MIN;
    const missed = await h.request('POST', '/v1/otp/request', { json: { token: LINK() } });
    expect(missed.status).toBe(409);
    h.clock.ms += 30_000;
    const portal = await h.loginPortal();
    const moved = await h.request('POST', '/v1/portal/reschedule', {
      token: portal,
      json: { toSlotId: 'abababab-abab-4bab-8bab-000000000001' },
    });
    expect(moved.status).toBe(200);
    const lobby = await lobbyThen(h);
    const res = await start(h, lobby);
    expect(res.status).toBe(200);
    expect(meta(h)?.startedAt).toBe(h.nb() + MIN);
  });
});

describe('a live DO session counts as started (R5-66 c) and a submitted row gets its receipt (R5-66 b)', () => {
  it('a session created at na − 10 s whose sessionStarted failed resumes after na through the peek', async () => {
    const h = await driveHarness();
    h.drive.failStarted = true;
    const lobby = await lobbyThen(h, h.lobbyOpensAt() + MIN);
    h.clock.ms = h.na() - 10_000;
    const failed = await start(h, lobby);
    expect(failed.status).toBe(503);
    const startedAt = meta(h)?.startedAt;
    expect(startedAt).toBe(h.na() - 10_000);
    expect(h.drive.state).toBe('otp_verified');

    h.drive.failStarted = false;
    h.clock.ms = h.na() + 5 * MIN;
    // The row is not started in api (window_missed), but the DO holds the session: OTP, mint and start go through.
    const again = await h.login();
    expect(apiCalls(h, 'messagingSend').at(-1)?.input).toMatchObject({ sessionLive: true });
    expect(apiCalls(h, 'lobbyMint').at(-1)?.input).toMatchObject({ sessionLive: true });
    const res = await start(h, again);
    expect(res.status).toBe(200);
    expect(apiCalls(h, 'sessionGrant').at(-1)?.input).toMatchObject({ sessionLive: true });
    expect(meta(h)?.startedAt).toBe(startedAt);
    expect(h.drive.state).toBe('started');
  });

  it('resolve after a failed sessionStarted: the edge peeks, re-asks with sessionLive, answers no window_missed; OTP then start resumes (decision a)', async () => {
    const h = await driveHarness();
    const startedAt = await failedStartAtNaMinus10s(h);
    h.clock.ms = h.na() + 5 * MIN;
    const before = apiCalls(h, 'inviteResolve').length;
    const res = await h.request('POST', '/v1/invite/resolve', { json: { token: LINK() } });
    expect(res.status).toBe(200);
    const body = InviteResolveRes.parse(await res.json());
    expect(body.schedule).toBeNull();
    expect(JSON.stringify(body)).not.toContain('window_missed');
    // The api's first answer had a schedule; the edge peeked and asked again with sessionLive, never editing it.
    expect(
      apiCalls(h, 'inviteResolve')
        .slice(before)
        .map((c) => c.input),
    ).toEqual([{ token: LINK() }, { token: LINK(), sessionLive: true }]);
    const again = await start(h, await h.login());
    expect(again.status).toBe(200);
    expect(meta(h)?.startedAt).toBe(startedAt);
    expect(h.drive.state).toBe('started');
  });

  it('resolve of a drive row whose object holds no session asks api once and copies its schedule (no sessionLive)', async () => {
    const h = await driveHarness();
    h.clock.ms = h.na() + MIN;
    const res = await h.request('POST', '/v1/invite/resolve', { json: { token: LINK() } });
    expect(res.status).toBe(200);
    expect(InviteResolveRes.parse(await res.json()).schedule?.phase).toBe('window_missed');
    expect(apiCalls(h, 'inviteResolve').map((c) => c.input)).toEqual([{ token: LINK() }]);
    expect(h.session.peeks).toEqual([INVITATION]);
  });

  it('resolve: a failed peek fails closed (503) and nothing is answered from the first api answer', async () => {
    const h = await driveHarness();
    const ns = h.session.ns;
    ns.get(ns.idFromName(INVITATION));
    const stored = h.session.sessions.get(INVITATION);
    if (stored === undefined) throw new Error('no fake session');
    stored.core.peek = () => Promise.reject(new Error('object reset'));
    const res = await h.request('POST', '/v1/invite/resolve', { json: { token: LINK() } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
  });

  it('resolve of a D1 row or a started row never peeks', async () => {
    const d1 = await sessionHarness();
    expect(
      (await d1.request('POST', '/v1/invite/resolve', { json: { token: LINK() } })).status,
    ).toBe(200);
    const started = await driveHarness({ state: 'started' });
    expect(
      (await started.request('POST', '/v1/invite/resolve', { json: { token: LINK() } })).status,
    ).toBe(200);
    expect([...d1.session.peeks, ...started.session.peeks]).toEqual([]);
  });

  it('a portal login and reschedule with a live DO session pass sessionLive true; api refuses 409 too_late_to_reschedule', async () => {
    const h = await driveHarness();
    await failedStartAtNaMinus10s(h);
    h.clock.ms = h.na() + 5 * MIN;
    const slot = h.drive.slotStartsAt;
    const portal = await h.loginPortal();
    expect(apiCalls(h, 'portalMint').at(-1)?.input).toMatchObject({ sessionLive: true });
    const res = await h.request('POST', '/v1/portal/reschedule', {
      token: portal,
      json: { toSlotId: SLOT_A },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'too_late_to_reschedule' });
    expect(apiCalls(h, 'portalReschedule').at(-1)?.input).toMatchObject({ sessionLive: true });
    expect(h.drive.slotStartsAt).toBe(slot);
  });

  it('a portal reschedule with no session in the object passes sessionLive false', async () => {
    const h = await driveHarness();
    h.clock.ms = h.na() + MIN;
    const portal = await h.loginPortal();
    const res = await h.request('POST', '/v1/portal/reschedule', {
      token: portal,
      json: { toSlotId: SLOT_A },
    });
    expect(res.status).toBe(200);
    expect(apiCalls(h, 'portalReschedule').at(-1)?.input).toMatchObject({ sessionLive: false });
  });

  it('a submitted drive row re-entering start gets its receipt and no token', async () => {
    const h = await driveHarness();
    const first = await start(h, await lobbyThen(h));
    const body = (await first.json()) as { sessionToken: string; view: { streamId: string } };
    const submitted = await h.request('POST', '/v1/session/submit', {
      token: body.sessionToken,
      json: { streamId: body.view.streamId, finalSeq: 0 },
    });
    expect(submitted.status).toBe(200);
    const receipt = await submitted.json();
    h.drive.state = 'submitted';
    h.clock.ms += 10 * MIN;
    const res = await start(h, await h.login());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'submitted', receipt });
  });
});

describe('SessionDO.peek is read only (R5-66 c)', () => {
  it('answers live false on an empty object and writes nothing; live true once a session exists', async () => {
    const h = await coreHarness();
    expect(await h.core.peek()).toEqual({ live: false });
    expect(h.kv.map.size).toBe(0);
    expect(h.alarm.at).toBeNull();
    expect((await h.core.start(startInput(h.sha256))).ok).toBe(true);
    const before = JSON.stringify([...h.kv.map.entries()]);
    expect(await h.core.peek()).toEqual({ live: true });
    expect(JSON.stringify([...h.kv.map.entries()])).toBe(before);
  });
});
