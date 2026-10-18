/// <reference types="@cloudflare/vitest-pool-workers/types" />
// C1b need 2 (C1a SR-6 for the session object): the real SessionDO class in the `edge-do` pool, over its SQLite-backed
// `ctx.storage.kv` and `transactionSync`, its one alarm (`setAlarm`/`deleteAlarm`), the local PACKAGES and EVIDENCE
// buckets and the MIRROR_QUEUE producer. SessionCore's logic is covered on fakes (session-do.*.test.ts); this test
// proves the wrapper wires it: start reads the package from R2, an events batch with a resend is deduped in storage,
// attach supersedes the older stream, the deadline alarm is set, and running it after the deadline auto-submits,
// writes final.json, events.ndjson and mirror.json to EVIDENCE and sends exactly one queue message. Synthetic data only.
import { SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256HexBytes } from './encoding.js';
import { evidenceKeys, GRACE_MS } from './session-core.js';
import { bound, sessionStub } from './real.test-helpers.js';
import {
  AUTH,
  DURATION_SECONDS,
  heartbeat,
  makePackage,
  PACKAGE_KEY,
  paste,
  startInput,
  text,
  WRITTEN,
} from './session.test-helpers.js';
import { ORG } from './token.test-helpers.js';

/** Puts the synthetic test package into the local PACKAGES bucket; returns its sha256. */
const installRealPackage = async (): Promise<string> => {
  const packages = env.PACKAGES;
  if (packages === undefined) throw new Error('the edge-do pool has no PACKAGES binding');
  const bytes = new TextEncoder().encode(JSON.stringify(makePackage()));
  await packages.put(PACKAGE_KEY, bytes);
  return sha256HexBytes(bytes);
};

const evidenceText = async (key: string): Promise<string> => {
  const found = await bound('EVIDENCE').get(key);
  if (found === null) throw new Error('evidence object missing');
  return found.text();
};

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionDO (real class, SQLite-backed storage, local R2 and queue)', () => {
  it('start, deduped events, attach, then the deadline alarm auto-submits to EVIDENCE and the queue once', async () => {
    const sessionId = crypto.randomUUID();
    const stub = sessionStub();
    const sha256 = await installRealPackage();

    const started = await stub.start(startInput(sha256, { sessionId }));
    if (!started.ok || started.kind !== 'live') throw new Error('start refused');
    const first = started.view.streamId;
    const alarmAt = Date.parse(started.startedAt) + DURATION_SECONDS * 1000 + GRACE_MS;

    // One batch, then a resend of it with one new event: acked to the high-water mark, stored once each.
    const batch = [text(1, WRITTEN, 0, 0, 'hello'), heartbeat(2)];
    expect(await stub.events(AUTH, { streamId: first, events: batch })).toMatchObject({
      ok: true,
      ackSeq: 2,
    });
    expect(
      await stub.events(AUTH, { streamId: first, events: [...batch, paste(3, WRITTEN, 5)] }),
    ).toMatchObject({ ok: true, ackSeq: 3 });

    // A reload: the new stream supersedes the first, and the session-wide gseq keeps counting.
    const attached = await stub.attach(AUTH);
    if (!attached.ok) throw new Error('attach refused');
    const second = attached.view.streamId;
    expect(second).not.toBe(first);
    expect(await stub.events(AUTH, { streamId: first, events: [heartbeat(4)] })).toMatchObject({
      ok: false,
      error: 'superseded',
    });
    expect(
      await stub.events(AUTH, { streamId: second, events: [text(1, WRITTEN, 5, 0, ' world')] }),
    ).toMatchObject({ ok: true, ackSeq: 1 });

    const stored = await runInDurableObject(stub, async (_instance, state) => ({
      gseqs: [...state.storage.kv.list<{ gseq: number }>({ prefix: 'ev:' })].map(([, e]) => e.gseq),
      alarm: await state.storage.getAlarm(),
    }));
    expect(stored).toEqual({ gseqs: [1, 2, 3, 4], alarm: alarmAt });

    // Watch the object's own MIRROR_QUEUE binding (the real send still runs).
    const sends: unknown[][] = [];
    await runInDurableObject(stub, (instance) => {
      const queue = (instance as unknown as { env: Env }).env.MIRROR_QUEUE;
      if (queue === undefined) throw new Error('the object has no MIRROR_QUEUE binding');
      const real = queue.send.bind(queue);
      vi.spyOn(queue, 'send').mockImplementation((...args) => {
        sends.push(args);
        return real(...args);
      });
    });

    // Past deadline + grace on the object's clock: the alarm auto-submits.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(alarmAt + 1_000);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const keys = evidenceKeys(ORG, sessionId);
    const final = JSON.parse(await evidenceText(keys.final)) as {
      answers: { position: number; text?: string }[];
    };
    expect(final.answers).toEqual([
      expect.objectContaining({ position: WRITTEN, text: 'hello world' }),
    ]);
    const lines = (await evidenceText(keys.events))
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { gseq: number; kind: string });
    expect(lines.map((l) => [l.gseq, l.kind])).toEqual([
      [2, 'heartbeat'],
      [3, 'signal'],
    ]);
    const mirror = SessionMirrorMessage.parse(JSON.parse(await evidenceText(keys.mirror)));
    expect(mirror).toMatchObject({
      sessionId,
      state: 'auto_submitted',
      lastEventSeq: 4,
      streamCount: 2,
      replay: 'ok',
    });
    expect(sends).toEqual([[mirror, { contentType: 'json' }]]);

    // Acked: the alarm slot is clear, so nothing runs or sends again.
    const meta = await runInDurableObject(stub, (_instance, state) =>
      state.storage.kv.get<{ mirror: { state: string } }>('meta'),
    );
    expect(meta?.mirror.state).toBe('acked');
    expect(await runDurableObjectAlarm(stub)).toBe(false);
    expect(sends).toHaveLength(1);
  });

  it('refuses a start whose package is not in PACKAGES, and stores nothing', async () => {
    const stub = sessionStub();
    const out = await stub.start(
      startInput('0'.repeat(64), {
        sessionId: crypto.randomUUID(),
        packageKey: `packages/${crypto.randomUUID()}.json`,
      }),
    );
    expect(out).toMatchObject({ ok: false, error: 'unavailable', pkg: 'missing' });
    const keys = await runInDurableObject(stub, (_instance, state) => [...state.storage.kv.list()]);
    expect(keys).toEqual([]);
  });
});
