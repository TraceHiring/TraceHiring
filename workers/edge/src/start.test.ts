// AT-D35, edge part, and AT-D12's SessionDO.start refusal (L-13; specs/d1-demo-slice.md §4.1 step 7, §4.2, §4.4
// Start / attach, §4.8 RT-7, RT-8, RT-11, RT-12): `session/start` runs sessionGrant, then SessionDO.start, then
// sessionStarted. The object refuses without `adultConfirmed`; an invalid or missing package is 503, nothing is served
// and `session.package_invalid` is logged with `sessionId` and `pkg` only; a failed start changes nothing in Postgres
// (no sessionStarted), keeps the lobby token alive and a retry succeeds; dead links never reach the object; a started
// session runs to its deadline whatever the link's state; a finished session answers its receipt.
import { SessionStartRes, SessionView } from '@trace/shared/contracts/candidate';
import { describe, expect, it } from 'vitest';
import {
  coreHarness,
  heartbeat,
  makePackage,
  PACKAGE_KEY,
  postEvents,
  sessionHarness,
  startInput,
  WRITTEN,
  installPackage,
  type SessionRouteHarness,
} from './session.test-helpers.js';
import { INVITATION } from './token.test-helpers.js';

const startBody = { rulesAcknowledged: true, photo: { skippedReason: 'declined' } };

const tryStart = async (h: SessionRouteHarness, lobby: string, body: unknown = startBody) =>
  h.request('POST', '/v1/session/start', { token: lobby, json: body });

const called = (h: SessionRouteHarness, method: string) =>
  h.calls.filter((c) => c.method === method).length;

const logLines = (h: SessionRouteHarness) =>
  h.lines.map((l) => JSON.parse(l) as { event: string; data?: Record<string, unknown> });

describe('SessionDO.start refuses without adultConfirmed (AT-D12, L-13, rule 9)', () => {
  it('the object refuses and stores nothing: no session, no package, no alarm', async () => {
    const h = await coreHarness();
    const out = await h.core.start(startInput(h.sha256, { adultConfirmed: false }));

    expect(out).toEqual({ ok: false, error: 'not_eligible' });
    expect(h.kv.map.size).toBe(0);
    expect(h.alarm.at).toBeNull();
    expect(h.packages.calls).not.toContain('get');
  });

  it('the object refuses a resume without adultConfirmed too', async () => {
    const h = await coreHarness();
    expect((await h.core.start(startInput(h.sha256))).ok).toBe(true);
    const out = await h.core.start(
      startInput(h.sha256, { adultConfirmed: false, nonce: 'session-nonce-0009-abcdef' }),
    );
    expect(out).toEqual({ ok: false, error: 'not_eligible' });
  });

  it('a grant that does not confirm the adult never reaches the object (503) and nothing is started', async () => {
    const h = await sessionHarness();
    const api = h.env.API as unknown as Record<string, (i: unknown) => Promise<unknown>>;
    const grant = api.sessionGrant;
    if (grant === undefined) throw new Error('no grant');
    api.sessionGrant = async (input) => ({
      ...((await grant(input)) as object),
      adultConfirmed: false,
    });
    const lobby = await h.login();
    const res = await tryStart(h, lobby);

    expect(res.status).toBe(503);
    expect(h.session.names).toEqual([]);
    expect(called(h, 'sessionStarted')).toBe(0);
  });

  it('an api refusal (not_eligible, step_required) is answered as is and nothing is started', async () => {
    for (const code of ['not_eligible', 'step_required'] as const) {
      const h = await sessionHarness();
      const api = h.env.API as unknown as Record<string, (i: unknown) => Promise<unknown>>;
      api.sessionGrant = async () => {
        throw new Error(code);
      };
      const lobby = await h.login();
      const res = await tryStart(h, lobby);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: code });
      expect(h.session.names).toEqual([]);
    }
  });
});

describe('session/start (AT-D35)', () => {
  it('answers the session token, its expiry and the view; the lobby token is then dead', async () => {
    const h = await sessionHarness();
    const lobby = await h.login();
    const res = await tryStart(h, lobby);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = SessionStartRes.parse(await res.json());
    if (!('sessionToken' in body)) throw new Error('expected a token');
    const view = SessionView.parse(body.view);
    expect(view.state).toBe('in_progress');
    expect(view.items.map((i) => i.servedAt)).toEqual([null, null, null]);
    expect(Date.parse(body.expiresAt) - h.clock.ms).toBe((1200 + 3600) * 1000);
    expect(h.calls.map((c) => c.method).slice(-2)).toEqual(['sessionGrant', 'sessionStarted']);
    expect(h.session.names).toEqual([INVITATION]);

    // §4.3: the lobby nonce is cleared when the session token is granted.
    const again = await h.request('GET', '/v1/lobby/notice', { token: lobby });
    expect(again.status).toBe(401);
  });

  it('a session token cannot start a session, and a lobby token cannot use the session routes', async () => {
    const h = await sessionHarness();
    const lobby = await h.login();
    const { token } = await (async () => {
      const res = await tryStart(h, lobby);
      return (await res.json()) as { sessionToken: string };
    })().then((b) => ({ token: b.sessionToken }));

    expect((await tryStart(h, token)).status).toBe(401);
    h.clock.ms += 31_000;
    const lobby2 = await h.login();
    const res = await h.request('POST', '/v1/session/attach', { token: lobby2 });
    expect(res.status).toBe(401);
  });

  it.each([
    ['missing', null],
    ['hash', 'hash'],
    ['schema', { ...makePackage(), answerKey: { 1: 'a' } }],
    ['schema', 'not json at all'],
    ['too_large', 'x'.repeat(256 * 1024 + 1)],
    ['mismatch', makePackage({ durationSeconds: 600 })],
  ])(
    'an invalid package (%s) is 503: nothing served, package_invalid logged with sessionId and pkg only',
    async (cause, pkg) => {
      const h = await sessionHarness();
      if (pkg === null) h.packages.objects.delete(PACKAGE_KEY);
      else if (pkg === 'hash') await installPackage(h.packages, makePackage({ title: 'Changed' }));
      else {
        // Keep the grant's hash equal to the stored bytes, so only the named check fails.
        const sha = await installPackage(h.packages, pkg);
        const api = h.env.API as unknown as Record<string, (i: unknown) => Promise<unknown>>;
        const grant = api.sessionGrant;
        if (grant === undefined) throw new Error('no grant');
        api.sessionGrant = async (input) => ({
          ...((await grant(input)) as object),
          packageSha256: sha,
        });
      }
      const lobby = await h.login();
      const res = await tryStart(h, lobby);

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'unavailable' });
      expect(called(h, 'sessionStarted')).toBe(0);
      const session = h.session.sessions.get(INVITATION);
      expect(session?.kv.map.size).toBe(0);
      expect(session?.alarm.at).toBeNull();
      const invalid = logLines(h).filter((l) => l.event === 'session.package_invalid');
      expect(invalid).toHaveLength(1);
      expect(Object.keys(invalid[0]?.data ?? {}).sort()).toEqual(['pkg', 'sessionId']);
      expect(invalid[0]?.data?.pkg).toBe(cause);
    },
  );

  it('a failed DO start changes nothing; the lobby token still works and a retry succeeds (RT-11)', async () => {
    const h = await sessionHarness();
    h.packages.state.failGets = 1;
    const lobby = await h.login();
    const failed = await tryStart(h, lobby);

    expect(failed.status).toBe(503);
    expect(called(h, 'sessionStarted')).toBe(0);
    expect(h.api.startedAt).toBeNull();
    // An unavailable bucket is not an invalid package: no package_invalid line.
    expect(logLines(h).some((l) => l.event === 'session.package_invalid')).toBe(false);

    h.clock.ms += 10_000;
    const retry = await tryStart(h, lobby);
    expect(retry.status).toBe(200);
    expect(called(h, 'sessionStarted')).toBe(1);
    expect(h.api.startedAt).toBe(new Date(h.clock.ms).toISOString());
  });

  it.each([
    ['link_expired', 410],
    ['link_revoked', 410],
  ])(
    'a dead link (%s) is refused by api before any object is touched (RT-7)',
    async (code, status) => {
      const h = await sessionHarness();
      const lobby = await h.login();
      const api = h.env.API as unknown as Record<string, (i: unknown) => Promise<unknown>>;
      api.sessionGrant = async () => {
        throw new Error(code);
      };
      const res = await tryStart(h, lobby);

      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: code });
      expect(h.session.names).toEqual([]);
    },
  );

  it('a started session runs to its deadline whatever the link state (the object never reads Postgres)', async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    const api = h.env.API as unknown as Record<string, (i: unknown) => Promise<unknown>>;
    api.inviteResolve = async () => {
      throw new Error('link_expired');
    };
    api.sessionGrant = async () => {
      throw new Error('link_expired');
    };
    const before = h.calls.length;
    const res = await postEvents(h, token, view.streamId, [heartbeat(1)]);

    expect(res.status).toBe(200);
    expect(h.calls.length).toBe(before);
  });

  it('a later start of a finished session answers its receipt and no token', async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    h.clock.ms += 5000;
    const submitted = await h.request('POST', '/v1/session/submit', {
      token,
      json: { streamId: view.streamId, finalSeq: 0 },
    });
    const receipt = await submitted.json();

    h.clock.ms += 60_000;
    const lobby = await h.login();
    const res = await tryStart(h, lobby);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'submitted', receipt });
  });

  it('a declared start photo must exist under its key with the same sha256', async () => {
    const h = await sessionHarness();
    const sha256 = 'd'.repeat(64);
    const lobby = await h.login();
    const missing = await tryStart(h, lobby, { rulesAcknowledged: true, photo: { sha256 } });
    expect(missing.status).toBe(403);
    expect(await missing.json()).toEqual({ error: 'step_required' });

    const key = `media/22222222-2222-4222-8222-222222222222/44444444-4444-4444-8444-444444444444/start_photo.jpg`;
    await h.evidence.bucket.put(key, new Uint8Array(10), {
      customMetadata: { sha256: 'e'.repeat(64) },
    });
    h.clock.ms += 10_000;
    const other = await tryStart(h, lobby, { rulesAcknowledged: true, photo: { sha256 } });
    expect(other.status).toBe(400);
    expect(h.session.names).toEqual([]);
  });

  it('ignores identity keys in the body: the object id comes from the verified claims', async () => {
    const h = await sessionHarness();
    const lobby = await h.login();
    const res = await tryStart(h, lobby, {
      ...startBody,
      invitationId: '55555555-5555-4555-8555-555555555555',
      orgId: '55555555-5555-4555-8555-555555555555',
    });
    expect(res.status).toBe(200);
    expect(h.session.names).toEqual([INVITATION]);
  });
});

describe('GET /v1/session/items/:pos', () => {
  it('serves one prompt and stamps served_at once, from the server clock', async () => {
    const h = await sessionHarness();
    const { token } = await h.startSession();
    h.clock.ms += 7_000;
    const first = await h.request('GET', `/v1/session/items/${WRITTEN}`, { token });
    const servedAt = new Date(h.clock.ms).toISOString();
    h.clock.ms += 7_000;
    const second = await h.request('GET', `/v1/session/items/${WRITTEN}`, { token });

    expect(first.status).toBe(200);
    const item = (await first.json()) as Record<string, unknown>;
    expect(item).toEqual({
      position: WRITTEN,
      kind: 'written',
      sectionId: expect.any(String),
      prompt: 'Synthetic question two.',
      maxChars: 10_000,
      servedAt,
    });
    expect(((await second.json()) as { servedAt: string }).servedAt).toBe(servedAt);
  });

  it.each(['0', '4', 'abc', '1e2', '-1'])('refuses position %s with 400', async (pos) => {
    const h = await sessionHarness();
    const { token } = await h.startSession();
    const res = await h.request('GET', `/v1/session/items/${pos}`, { token });
    expect(res.status).toBe(400);
  });
});
