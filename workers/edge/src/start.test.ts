// AT-D35, edge part, and AT-D12's SessionDO.start refusal (L-13; specs/d1-demo-slice.md §4.1 step 7, §4.2, §4.4
// Start / attach, §4.8 RT-7, RT-8, RT-11, RT-12): `session/start` runs sessionGrant, then SessionDO.start, then
// sessionStarted. The object refuses without `adultConfirmed`; an invalid or missing package is 503, nothing is served
// and `session.package_invalid` is logged with `sessionId` and `pkg` only; a failed start changes nothing in Postgres
// (no sessionStarted), keeps the lobby token alive and a retry succeeds; dead links never reach the object; a started
// session runs to its deadline whatever the link's state; a finished session answers its receipt.
import {
  SessionMirrorMessage,
  SessionStartRes,
  SessionView,
} from '@trace/shared/contracts/candidate';
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
import { sha256HexBytes } from './encoding.js';
import { testJpeg } from './edge.test-helpers.js';
import { INVITATION, ORG, SESSION } from './token.test-helpers.js';

const startBody = { rulesAcknowledged: true, photo: { skippedReason: 'declined' } };

/** The canonical key the session, the mirror and the database use; only session start writes it. */
const PHOTO_KEY = `media/${ORG}/${SESSION}/start_photo.jpg`;
/** The working key the lobby upload route writes (retakes overwrite it). */
const UPLOAD_KEY = `media/${ORG}/${SESSION}/start_photo.upload.jpg`;

/** Uploads a start photo through PUT /v1/lobby/photo; returns its sha256. */
const uploadPhoto = async (
  h: SessionRouteHarness,
  lobby: string,
  bytes: Uint8Array = testJpeg(640, 480),
): Promise<string> => {
  const sha256 = await sha256HexBytes(bytes);
  const res = await h.request('PUT', '/v1/lobby/photo', {
    token: lobby,
    body: bytes,
    headers: { 'content-type': 'image/jpeg', 'x-photo-sha256': sha256 },
  });
  if (res.status !== 200) throw new Error(`photo upload ${res.status}`);
  return sha256;
};

/** The invitation's InviteOtpDO logic (it exists once the candidate logged in). */
const otpCore = (h: SessionRouteHarness) => {
  const core = h.otp.cores.get(INVITATION);
  if (core === undefined) throw new Error('no otp object');
  return core;
};

/** The photo the SessionDO stored in its meta, or undefined when no session exists. */
const storedPhoto = (h: SessionRouteHarness) =>
  h.session.sessions.get(INVITATION)?.kv.get<{ photo: unknown }>('meta')?.photo;

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

  it('a declared start photo must exist under its working key with the same sha256', async () => {
    const h = await sessionHarness();
    const sha256 = 'd'.repeat(64);
    const lobby = await h.login();
    const missing = await tryStart(h, lobby, { rulesAcknowledged: true, photo: { sha256 } });
    expect(missing.status).toBe(403);
    expect(await missing.json()).toEqual({ error: 'step_required' });

    // The lobby uploads to the working key now (SEC-1 residual); start pins it to start_photo.jpg itself.
    const key = `media/22222222-2222-4222-8222-222222222222/44444444-4444-4444-8444-444444444444/start_photo.upload.jpg`;
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

describe('session tokens after submit (SR-5, RT-3; SEC-C1b-5)', () => {
  const submit = (h: SessionRouteHarness, token: string, streamId: string, finalSeq: number) =>
    h.request('POST', '/v1/session/submit', { token, json: { streamId, finalSeq } });

  it('an older token that a resume replaced is 401 superseded after submit too', async () => {
    const h = await sessionHarness();
    const first = await h.startSession();
    h.clock.ms += 31_000;
    const second = await h.startSession();
    const before = await h.request('POST', '/v1/session/attach', { token: first.token });
    expect(await before.json()).toEqual({ error: 'superseded' });

    h.clock.ms += 1000;
    expect((await submit(h, second.token, second.view.streamId, 0)).status).toBe(200);
    const after = await h.request('POST', '/v1/session/attach', { token: first.token });
    expect(after.status).toBe(401);
    expect(await after.json()).toEqual({ error: 'superseded' });
    // The token that was current at submit still reads its receipt.
    expect((await h.request('POST', '/v1/session/attach', { token: second.token })).status).toBe(
      200,
    );
  });

  it('attach after submit shows the receipt and no answer text', async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    const answer = 'synthetic answer text kept in the object';
    const edits = [
      { seq: 1, t: 100, kind: 'answer.text', item: WRITTEN, p: 0, d: 0, i: answer },
      { seq: 2, t: 200, kind: 'answer.choice', item: 1, option: 'a' },
    ] as Parameters<typeof postEvents>[3];
    expect((await postEvents(h, token, view.streamId, edits)).status).toBe(200);
    const live = await h.request('POST', '/v1/session/attach', { token });
    const liveView = ((await live.json()) as { view: { answers: unknown[]; streamId: string } })
      .view;
    expect(liveView.answers).toHaveLength(2);

    h.clock.ms += 1000;
    const receipt = await (await submit(h, token, liveView.streamId, 0)).json();

    const res = await h.request('POST', '/v1/session/attach', { token });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain(answer);
    const shown = (JSON.parse(raw) as { view: { answers: unknown[]; receipt: unknown } }).view;
    expect(shown.answers).toEqual([]);
    expect(shown.receipt).toEqual(receipt);
  });
});

describe('session/start closes the photo step before it reads the photo (C1a SEC-1)', () => {
  const photoBody = (sha256: string) => ({ rulesAcknowledged: true, photo: { sha256 } });
  const count = (calls: string[], name: string) => calls.filter((c) => c === name).length;

  it('closePhotos runs after the grant and before the photo is read; the session holds the photo', async () => {
    const h = await sessionHarness();
    const lobby = await h.login();
    const sha256 = await uploadPhoto(h, lobby);
    const order: string[] = [];
    const core = otpCore(h);
    const close = core.closePhotos.bind(core);
    core.closePhotos = () => {
      order.push(called(h, 'sessionGrant') === 1 ? 'closePhotos' : 'closePhotos before the grant');
      close();
    };
    const bucket = h.evidence.bucket;
    const head = bucket.head.bind(bucket);
    const get = bucket.get.bind(bucket);
    bucket.head = async (key: string) => {
      order.push('read');
      return head(key);
    };
    bucket.get = async (key: string) => {
      order.push('read');
      return get(key);
    };

    const res = await tryStart(h, lobby, photoBody(sha256));
    expect(res.status).toBe(200);
    expect(order[0]).toBe('closePhotos');
    expect(order[1]).toBe('read');
    expect(count(order, 'closePhotos')).toBe(1);
    expect(storedPhoto(h)).toEqual({
      key: PHOTO_KEY,
      sha256,
      bytes: testJpeg(640, 480).length,
    });
  });

  it('a refused grant does not close the photo step; a start without a photo closes it', async () => {
    const h = await sessionHarness();
    const api = h.env.API as unknown as Record<string, (i: unknown) => Promise<unknown>>;
    const grant = api.sessionGrant;
    if (grant === undefined) throw new Error('no grant');
    api.sessionGrant = async () => {
      throw new Error('step_required');
    };
    const lobby = await h.login();
    expect((await tryStart(h, lobby)).status).toBe(403);
    expect(h.otp.kvs.get(INVITATION)?.get('photo:closed')).toBeUndefined();

    api.sessionGrant = grant;
    h.clock.ms += 10_000;
    expect((await tryStart(h, lobby)).status).toBe(200);
    expect(h.otp.kvs.get(INVITATION)?.get('photo:closed')).toBe(true);
  });

  it('after start an upload is 410 closed and nothing is written to R2', async () => {
    const h = await sessionHarness();
    const lobby = await h.login();
    const sha256 = await uploadPhoto(h, lobby);
    expect((await tryStart(h, lobby, photoBody(sha256))).status).toBe(200);
    const puts = count(h.evidence.calls, 'put');
    const stored = h.evidence.objects.get(PHOTO_KEY)?.body;

    // An upload past lobby auth (a fresh login) and photoPermit (the harness permit is never locked): only the
    // object's closed photo step stops it.
    h.clock.ms += 31_000;
    const lobby2 = await h.login();
    const other = testJpeg(800, 600);
    const res = await h.request('PUT', '/v1/lobby/photo', {
      token: lobby2,
      body: other,
      headers: { 'content-type': 'image/jpeg', 'x-photo-sha256': await sha256HexBytes(other) },
    });
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'closed' });
    expect(count(h.evidence.calls, 'put')).toBe(puts);
    expect(h.evidence.objects.get(PHOTO_KEY)?.body).toEqual(stored);
  });

  it('a closePhotos failure is 503 unavailable: no photo read, no SessionDO, nothing started', async () => {
    const h = await sessionHarness();
    const lobby = await h.login();
    const sha256 = await uploadPhoto(h, lobby);
    otpCore(h).closePhotos = () => {
      throw new Error('object reset');
    };
    const reads = count(h.evidence.calls, 'head') + count(h.evidence.calls, 'get');

    const res = await tryStart(h, lobby, photoBody(sha256));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
    expect(count(h.evidence.calls, 'head') + count(h.evidence.calls, 'get')).toBe(reads);
    expect(h.session.names).toEqual([]);
    expect(called(h, 'sessionStarted')).toBe(0);
    // The lobby nonce is cleared only after a start, so the candidate can retry.
    expect((await h.request('GET', '/v1/lobby/notice', { token: lobby })).status).toBe(200);
  });

  it('a retried start after a close works (closePhotos is set-once and idempotent)', async () => {
    const h = await sessionHarness();
    const lobby = await h.login();
    const sha256 = await uploadPhoto(h, lobby);
    h.packages.state.failGets = 1;
    expect((await tryStart(h, lobby, photoBody(sha256))).status).toBe(503);
    expect(h.otp.kvs.get(INVITATION)?.get('photo:closed')).toBe(true);

    h.clock.ms += 10_000;
    const retry = await tryStart(h, lobby, photoBody(sha256));
    expect(retry.status).toBe(200);
    expect(h.otp.kvs.get(INVITATION)?.get('photo:closed')).toBe(true);
    expect(storedPhoto(h)).toEqual({
      key: PHOTO_KEY,
      sha256,
      bytes: testJpeg(640, 480).length,
    });
  });
});

describe('session start pins the photo from the working key (SEC-1 residual)', () => {
  const photoBody = (sha256: string) => ({ rulesAcknowledged: true, photo: { sha256 } });
  const photoOps = (h: SessionRouteHarness) => h.ops.filter((o) => o.includes('/start_photo'));
  const canonicalBytes = (h: SessionRouteHarness): Uint8Array => {
    const stored = h.evidence.objects.get(PHOTO_KEY);
    if (stored === undefined) throw new Error('no canonical photo');
    return stored.body;
  };
  const started = async (res: Response) => {
    expect(res.status).toBe(200);
    return (await res.json()) as { sessionToken: string; view: SessionView };
  };

  it('an upload still in flight at start cannot change the photo: canonical = DO = mirror = S1', async () => {
    const h = await sessionHarness();
    const lobby = await h.login();
    const p1 = testJpeg(640, 480);
    const s1 = await uploadPhoto(h, lobby, p1);
    // A second upload took its slot before the close and is still inside its R2 put.
    const slot = otpCore(h).takePhotoSlot();
    if (!slot.ok) throw new Error('no slot');
    await started(await tryStart(h, lobby, photoBody(s1)));
    // ... and lands on the working key after start pinned the photo.
    const p2 = testJpeg(800, 600);
    const s2 = await sha256HexBytes(p2);
    await h.evidence.bucket.put(UPLOAD_KEY, p2, {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { sha256: s2, blurred: '1', n: String(slot.n) },
    });

    expect(canonicalBytes(h)).toEqual(p1);
    expect(await sha256HexBytes(canonicalBytes(h))).toBe(s1);
    expect(h.evidence.objects.get(PHOTO_KEY)?.customMetadata).toEqual({ sha256: s1, blurred: '1' });
    expect(storedPhoto(h)).toEqual({ key: PHOTO_KEY, sha256: s1, bytes: p1.length });
    // The photo route wrote only the working key; start wrote the canonical key once and removed the working copy.
    expect(photoOps(h)).toEqual([
      `put:${UPLOAD_KEY}`,
      `put:${PHOTO_KEY}`,
      `delete:${UPLOAD_KEY}`,
      `put:${UPLOAD_KEY}`,
    ]);

    // A resume that declares the late photo S2 changes neither the canonical object nor the session's photo.
    h.clock.ms += 31_000;
    const resumed = await started(await tryStart(h, await h.login(), photoBody(s2)));
    expect(canonicalBytes(h)).toEqual(p1);
    expect(storedPhoto(h)).toEqual({ key: PHOTO_KEY, sha256: s1, bytes: p1.length });
    expect(photoOps(h).filter((o) => o === `put:${PHOTO_KEY}`)).toHaveLength(1);

    h.clock.ms += 1000;
    const submitted = await h.request('POST', '/v1/session/submit', {
      token: resumed.sessionToken,
      json: { streamId: resumed.view.streamId, finalSeq: 0 },
    });
    expect(submitted.status).toBe(200);
    expect(SessionMirrorMessage.parse(h.queue.sent[0]).photo).toEqual({
      key: PHOTO_KEY,
      sha256: s1,
      bytes: p1.length,
      mime: 'image/jpeg',
      blurredOnDevice: true,
    });
  });

  it('a start that skips the photo removes an uploaded working copy (rule 8: no face photo kept after declining)', async () => {
    const h = await sessionHarness();
    const lobby = await h.login();
    await uploadPhoto(h, lobby, testJpeg(640, 480));
    expect(h.evidence.objects.has(UPLOAD_KEY)).toBe(true);

    await started(await tryStart(h, lobby, startBody));

    expect(h.evidence.objects.has(UPLOAD_KEY)).toBe(false);
    expect(h.evidence.objects.has(PHOTO_KEY)).toBe(false);
    expect(storedPhoto(h)).toBeNull();
    expect(photoOps(h)).toEqual([`put:${UPLOAD_KEY}`, `delete:${UPLOAD_KEY}`]);
  });

  it('a resume declaring the pinned photo works after the working copy was removed', async () => {
    const h = await sessionHarness();
    const lobby = await h.login();
    const p1 = testJpeg(640, 480);
    const s1 = await uploadPhoto(h, lobby, p1);
    await started(await tryStart(h, lobby, photoBody(s1)));
    expect(h.evidence.objects.has(UPLOAD_KEY)).toBe(false);

    h.clock.ms += 31_000;
    await started(await tryStart(h, await h.login(), photoBody(s1)));
    expect(canonicalBytes(h)).toEqual(p1);
    expect(photoOps(h).filter((o) => o === `put:${PHOTO_KEY}`)).toHaveLength(1);
  });

  it.each([
    ['bytes that do not hash to the declared sha256', 'bytes'],
    ['metadata that does not carry the declared sha256', 'metadata'],
    ['more than 512 000 bytes', 'size'],
  ])('a working object with %s is 400 and the SessionDO is never called', async (_label, kind) => {
    const h = await sessionHarness();
    const lobby = await h.login();
    const p1 = testJpeg(640, 480);
    const p2 = testJpeg(800, 600);
    const big = testJpeg(640, 480, 512_000);
    const s1 = await sha256HexBytes(p1);
    const stored = { bytes: p2, meta: s1, declared: s1 };
    if (kind === 'metadata') Object.assign(stored, { bytes: p1, meta: await sha256HexBytes(p2) });
    if (kind === 'size') {
      const sBig = await sha256HexBytes(big);
      Object.assign(stored, { bytes: big, meta: sBig, declared: sBig });
    }
    await h.evidence.bucket.put(UPLOAD_KEY, stored.bytes, {
      customMetadata: { sha256: stored.meta, blurred: '1', n: '1' },
    });

    const res = await tryStart(h, lobby, photoBody(stored.declared));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request' });
    expect(h.session.names).toEqual([]);
    expect(called(h, 'sessionStarted')).toBe(0);
    expect(h.evidence.objects.has(PHOTO_KEY)).toBe(false);
  });

  it('a failed canonical put is 503 with no token; the retry writes S1 with the same startedAt', async () => {
    const h = await sessionHarness();
    const lobby = await h.login();
    const p1 = testJpeg(640, 480);
    const s1 = await uploadPhoto(h, lobby, p1);
    const firstStart = new Date(h.clock.ms).toISOString();
    h.evidence.state.failPuts = 1;

    const failed = await tryStart(h, lobby, photoBody(s1));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: 'unavailable' });
    expect(called(h, 'sessionStarted')).toBe(0);
    expect(h.evidence.objects.has(PHOTO_KEY)).toBe(false);
    expect(h.evidence.objects.has(UPLOAD_KEY)).toBe(true);

    h.clock.ms += 10_000;
    await started(await tryStart(h, lobby, photoBody(s1)));
    expect(canonicalBytes(h)).toEqual(p1);
    expect(storedPhoto(h)).toEqual({ key: PHOTO_KEY, sha256: s1, bytes: p1.length });
    expect(h.api.startedAt).toBe(firstStart);
  });

  it('the lobby photo route never names the canonical key (static)', () => {
    const sources = import.meta.glob(['./routes-photo.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const source = Object.values(sources)[0] ?? '';
    expect(source).toContain('startPhotoUploadKey(');
    expect(source).not.toMatch(/start_photo\.jpg|\bstartPhotoKey\b/);
  });
});
