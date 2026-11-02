// AT-D27, edge part (specs/d1-demo-slice.md §4.4 "The one mirror message", "Delivery and fallback"; L-18; RT-11):
// exactly one mirror message per session, valid against SessionMirrorMessage; `final.json`, `events.ndjson` and then
// `mirror.json` (the same JSON as the message) are in R2 before the queue send; a queue or R2 failure leaves
// `mirror_state` pending and the alarm retries after 5 s, 15 s, 60 s, then every 5 min, for 24 h, then `failed` and
// `session.mirror_failed`; `acked` only after the queue accepted the message; a retried `session/start` keeps the DO's
// `startedAt`. The "both transports through the same pipeline fixtures" assertion lives in workers/jobs (L-23).
import { SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import { describe, expect, it } from 'vitest';
import { sha256Hex, sha256HexBytes } from './encoding.js';
import { objectText } from './edge.test-helpers.js';
import { evidenceKeys, MIRROR_GIVE_UP_MS, MIRROR_LEASE_MS } from './session-core.js';
import { receiptRefOf } from './session-evidence.js';
import {
  AUTH,
  CONSENT,
  coreHarness,
  heartbeat,
  MCQ,
  choice,
  paste,
  RULESET,
  sessionHarness,
  startCore,
  TEST_VERSION,
  text,
  WRITTEN,
  type CoreHarness,
} from './session.test-helpers.js';
import { INVITATION, ORG, SESSION } from './token.test-helpers.js';

const KEYS = evidenceKeys(ORG, SESSION);

const mirrorState = (h: CoreHarness) =>
  h.kv.get<{ mirror: { state: string; attempts: number; nextAt: number | null } }>('meta')?.mirror;

/** Starts, saves a few events and submits; returns the stream id. */
const runAndSubmit = async (h: CoreHarness) => {
  const { view } = await startCore(h);
  h.clock.ms += 1000;
  await h.core.events(AUTH, {
    streamId: view.streamId,
    events: [
      heartbeat(1),
      text(2, WRITTEN, 0, 0, 'answer'),
      choice(3, MCQ, 'b'),
      paste(4, WRITTEN, 7),
    ],
  });
  h.clock.ms += 1000;
  const out = await h.core.submit(AUTH, { streamId: view.streamId, finalSeq: 4 });
  if (!out.ok) throw new Error(`submit refused: ${out.error}`);
  return { view, receipt: out.receipt };
};

describe('exactly one mirror message (AT-D27)', () => {
  it('sends one message that fits the contract, with the ids, job key, receipt and evidence hashes', async () => {
    const h = await coreHarness();
    const { view, receipt } = await runAndSubmit(h);

    expect(h.queue.sent).toHaveLength(1);
    const message = SessionMirrorMessage.parse(h.queue.sent[0]);
    expect(message).toMatchObject({
      v: 1,
      jobKind: 'session_mirror',
      mirrorSeq: 1,
      jobKey: `${SESSION}:session_mirror:${RULESET}`,
      sessionId: SESSION,
      orgId: ORG,
      invitationId: INVITATION,
      testVersionId: TEST_VERSION,
      rulesetVersionId: RULESET,
      consentId: CONSENT,
      state: 'submitted',
      receiptRef: receipt.receiptRef,
      startedAt: view.startedAt,
      deadlineAt: view.deadlineAt,
      submittedAt: receipt.submittedAt,
      lastEventSeq: 4,
      streamCount: 1,
      resumeCount: 0,
      replay: 'ok',
      signalCatalogVersion: 'd1-signals-v1',
      photo: null,
      photoSkippedReason: 'declined',
      evidence: { finalKey: KEYS.final, eventsKey: KEYS.events },
    });
    expect(receipt.receiptRef).toBe(await receiptRefOf(SESSION));
    expect(message.evidence.finalSha256).toBe(await sha256Hex(objectText(h.evidence, KEYS.final)));
    expect(message.evidence.eventsSha256).toBe(
      await sha256Hex(objectText(h.evidence, KEYS.events)),
    );
    expect(mirrorState(h)?.state).toBe('acked');
    // The message holds no signal list and no answer text: content stays in R2.
    expect(JSON.stringify(message)).not.toContain('answer');
  });

  it('writes final.json, events.ndjson and mirror.json (the same JSON) before the send', async () => {
    const h = await coreHarness();
    await runAndSubmit(h);

    expect(h.ops).toEqual([
      `put:${KEYS.final}`,
      `put:${KEYS.events}`,
      `put:${KEYS.mirror}`,
      'send',
    ]);
    expect(JSON.parse(objectText(h.evidence, KEYS.mirror))).toEqual(h.queue.sent[0]);
    expect(h.evidence.objects.get(KEYS.events)?.httpMetadata).toEqual({
      contentType: 'application/x-ndjson',
    });
  });

  it('records the served items with their item versions and server times', async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    h.clock.ms += 5000;
    await h.request('GET', `/v1/session/items/${WRITTEN}`, { token });
    const servedAt = new Date(h.clock.ms).toISOString();
    h.clock.ms += 5000;
    await h.request('GET', `/v1/session/items/${WRITTEN}`, { token });
    await h.request('POST', '/v1/session/submit', {
      token,
      json: { streamId: view.streamId, finalSeq: 0 },
    });

    const message = SessionMirrorMessage.parse(h.queue.sent[0]);
    expect(message.served).toEqual([
      { position: WRITTEN, itemVersionId: expect.any(String), servedAt },
    ]);
  });

  it('carries the verified start photo reference (the canonical key session start pinned)', async () => {
    const h = await sessionHarness();
    const bytes = new Uint8Array(300);
    const sha256 = await sha256HexBytes(bytes);
    const key = `media/${ORG}/${SESSION}/start_photo.jpg`;
    // The lobby writes the working key; session start verifies it and pins it to the canonical key (SEC-1).
    await h.evidence.bucket.put(`media/${ORG}/${SESSION}/start_photo.upload.jpg`, bytes, {
      customMetadata: { sha256 },
    });
    const { token, view } = await h.startSession({ sha256 });
    await h.request('POST', '/v1/session/submit', {
      token,
      json: { streamId: view.streamId, finalSeq: 0 },
    });

    const message = SessionMirrorMessage.parse(h.queue.sent[0]);
    expect(message.photo).toEqual({
      key,
      sha256,
      bytes: 300,
      mime: 'image/jpeg',
      blurredOnDevice: true,
    });
    expect(message.photoSkippedReason).toBeNull();
  });
});

describe('delivery retries (AT-D27)', () => {
  it('a queue failure leaves the mirror pending; the alarm retries after 5 s, 15 s, 60 s, then 5 min', async () => {
    const h = await coreHarness();
    h.queue.state.fail = 4;
    const { receipt } = await runAndSubmit(h);
    const submittedAt = Date.parse(receipt.submittedAt);

    expect(h.queue.sent).toEqual([]);
    expect(mirrorState(h)).toMatchObject({ state: 'pending', attempts: 1 });
    // mirror.json is in R2 before any send, so the jobs sweep could recover the session without the DO.
    expect(h.evidence.objects.has(KEYS.mirror)).toBe(true);

    const waits: number[] = [];
    let last = submittedAt;
    for (let k = 0; k < 4; k += 1) {
      const at = h.alarm.at;
      if (at === null) throw new Error('no retry alarm');
      waits.push(at - last);
      h.clock.ms = at;
      last = at;
      await h.core.alarm();
    }
    expect(waits).toEqual([5_000, 15_000, 60_000, 300_000]);
    expect(h.queue.sent).toHaveLength(1);
    expect(mirrorState(h)).toMatchObject({ state: 'acked', attempts: 5 });
    expect(h.alarm.at).toBeNull();
    // Every attempt sent the same JSON: the message is built once.
    expect(h.ops.filter((op) => op.startsWith('send'))).toEqual([
      'send:fail',
      'send:fail',
      'send:fail',
      'send:fail',
      'send',
    ]);
  });

  it('never reads acked unless the queue accepted the message', async () => {
    const h = await coreHarness();
    h.queue.state.fail = 1;
    await runAndSubmit(h);
    expect(mirrorState(h)?.state).toBe('pending');
    // A due-early alarm does not send.
    h.clock.ms += 1000;
    await h.core.alarm();
    expect(mirrorState(h)?.state).toBe('pending');
    expect(h.queue.sent).toEqual([]);
  });

  it('an R2 failure is retried the same way, and nothing is sent before mirror.json is written', async () => {
    const h = await coreHarness();
    h.evidence.state.failPuts = 1;
    await runAndSubmit(h);

    expect(h.queue.sent).toEqual([]);
    expect(h.ops).toEqual([]);
    const at = h.alarm.at;
    if (at === null) throw new Error('no retry alarm');
    h.clock.ms = at;
    await h.core.alarm();
    expect(h.ops).toEqual([
      `put:${KEYS.final}`,
      `put:${KEYS.events}`,
      `put:${KEYS.mirror}`,
      'send',
    ]);
    expect(mirrorState(h)?.state).toBe('acked');
  });

  it('after 24 h of failures the mirror is failed and session.mirror_failed is logged with ids and counts only', async () => {
    const h = await coreHarness();
    h.queue.state.fail = Number.MAX_SAFE_INTEGER;
    const { receipt } = await runAndSubmit(h);
    const submittedAt = Date.parse(receipt.submittedAt);
    let guard = 0;
    while (h.alarm.at !== null && guard < 1000) {
      h.clock.ms = h.alarm.at;
      await h.core.alarm();
      guard += 1;
    }

    expect(mirrorState(h)?.state).toBe('failed');
    expect(h.clock.ms - submittedAt).toBeGreaterThanOrEqual(MIRROR_GIVE_UP_MS);
    expect(h.clock.ms - submittedAt).toBeLessThan(MIRROR_GIVE_UP_MS + 300_000 + 1);
    expect(h.queue.sent).toEqual([]);
    const failed = h.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ level: 'error', event: 'session.mirror_failed' });
    // Ids and counts only (the redactor may still mask digit runs of the synthetic id).
    const data = failed[0]?.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(['n', 'sessionId']);
    expect(data.n).toBe(mirrorState(h)?.attempts);
    expect(typeof data.sessionId).toBe('string');
  });

  it('a delivery killed mid-attempt keeps counting; past 24 h the alarm marks failed once and stops (SEC-C1b-3)', async () => {
    const h = await coreHarness();
    // A process that dies inside the attempt: the evidence write never returns, so the bookkeeping after the attempt
    // never runs and the lease stays in storage.
    h.evidence.bucket.put = () => new Promise<never>(() => undefined);
    const settled = (p: Promise<unknown>) =>
      Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), 50))]);
    const lease = (): { state: string; attempts: number; leaseUntil: number | null } | undefined =>
      h.kv.get<{ mirror: { state: string; attempts: number; leaseUntil: number | null } }>('meta')
        ?.mirror;
    const { view } = await startCore(h);
    h.clock.ms += 1000;
    const submittedAt = h.clock.ms;
    expect(await settled(h.core.submit(AUTH, { streamId: view.streamId, finalSeq: 0 }))).toBe(
      false,
    );
    expect(lease()).toMatchObject({ state: 'pending', attempts: 1 });
    expect(lease()?.leaseUntil).toBe(submittedAt + MIRROR_LEASE_MS);
    expect(h.alarm.at).toBe(submittedAt + MIRROR_LEASE_MS);

    // The lease runs out and the alarm retries; that attempt dies too, and it is counted when the lease is taken.
    h.clock.ms = submittedAt + MIRROR_LEASE_MS;
    expect(await settled(h.core.alarm())).toBe(false);
    expect(lease()).toMatchObject({ state: 'pending', attempts: 2 });

    // Past 24 h from submit the next alarm gives up in the lease transaction: failed, logged once, nothing sent,
    // no further alarm.
    h.clock.ms = submittedAt + MIRROR_GIVE_UP_MS;
    expect(await settled(h.core.alarm())).toBe(true);
    expect(lease()).toMatchObject({ state: 'failed', leaseUntil: null });
    expect(h.alarm.at).toBeNull();
    expect(await settled(h.core.alarm())).toBe(true);
    expect(h.queue.sent).toEqual([]);
    const logged = h.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ level: 'error', event: 'session.mirror_failed' });
    const data = logged[0]?.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(['n', 'sessionId']);
    expect(data.n).toBe(lease()?.attempts);
  });

  it('a submit while a delivery is in flight does not send a second time (lease)', async () => {
    const h = await coreHarness();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = h.queue.queue.send.bind(h.queue.queue);
    h.queue.queue.send = async (message) => {
      await gate;
      await send(message);
    };
    const { view } = await startCore(h);
    h.clock.ms += 1000;
    const first = h.core.submit(AUTH, { streamId: view.streamId, finalSeq: 0 });
    // While the first send waits, an alarm and a repeated submit run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.clock.ms += 10_000;
    await h.core.alarm();
    const again = await h.core.submit(AUTH, { streamId: view.streamId, finalSeq: 0 });
    release();
    const done = await first;

    expect(again).toEqual(done);
    expect(h.queue.sent).toHaveLength(1);
    expect(mirrorState(h)?.state).toBe('acked');
    expect(MIRROR_LEASE_MS).toBeGreaterThan(10_000);
  });
});

describe('a retried session/start keeps startedAt (AT-D27, RT-11)', () => {
  it('sessionStarted failing after the DO ack: the retry sends the same startedAt and api stores it once', async () => {
    let failures = 1;
    const seen: unknown[] = [];
    const h = await sessionHarness({
      sessionStarted: async () => {
        throw new Error('unavailable');
      },
    });
    // Replace the api method with one that fails once, then stores set-once.
    const api = h.env.API as unknown as Record<
      string,
      (input: Record<string, unknown>) => Promise<unknown>
    >;
    api.sessionStarted = async (input) => {
      seen.push(input.startedAt);
      if (failures > 0) {
        failures -= 1;
        throw new Error('unavailable');
      }
      h.api.startedAt ??= String(input.startedAt);
      return { startedAt: h.api.startedAt };
    };

    const lobby = await h.login();
    const first = await h.request('POST', '/v1/session/start', {
      token: lobby,
      json: { rulesAcknowledged: true, photo: { skippedReason: 'no_camera' } },
    });
    expect(first.status).toBe(503);
    // The lobby token still works (its nonce is cleared only after a full success).
    h.clock.ms += 30_000;
    const retry = await h.request('POST', '/v1/session/start', {
      token: lobby,
      json: { rulesAcknowledged: true, photo: { skippedReason: 'no_camera' } },
    });
    expect(retry.status).toBe(200);
    const view = ((await retry.json()) as { view: { startedAt: string } }).view;

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(view.startedAt).toBe(seen[0]);
    expect(h.api.startedAt).toBe(seen[0]);
  });
});
