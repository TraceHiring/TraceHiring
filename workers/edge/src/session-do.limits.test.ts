// SEC-C1b-2: per-session storage caps on the SessionDO (specs/d1-demo-slice.md §4.2 limits, §4.4 Events). The rate
// limits alone (5 batches/s of up to 100 events) would let one session store millions of rows over a test, and the
// finalise pass reads every stored event. So the object keeps, in its own storage (it survives a restart), a count of
// stored events and of their stored bytes (UTF-8 of the stored JSON): a batch that would pass 50 000 events or 20 MB is
// refused whole with 413 `too_large` and nothing of it is kept. Heartbeats are thinned: a burst allowance, then at most
// one stored per 5 s of the object's time; the rest are acknowledged (the stream's `seq` advances, dedupe holds) but
// not stored, so an honest 10 s cadence is never thinned and coverage is unchanged for it. Synthetic data only.
import type { ClientEvent } from '@trace/shared/contracts/candidate';
import { createLogger } from '@trace/shared/log';
import { describe, expect, it } from 'vitest';
import { mapTransaction, objectText, type MapKv } from './edge.test-helpers.js';
import {
  evidenceKeys,
  HEARTBEAT_BURST,
  HEARTBEAT_STORE_EVERY_MS,
  MAX_STORED_EVENT_BYTES,
  MAX_STORED_EVENTS,
  SessionCore,
} from './session-core.js';
import {
  AUTH,
  coreHarness,
  heartbeat,
  paste,
  postEvents,
  serveCore,
  sessionHarness,
  startCore,
  text,
  WRITTEN,
  type CoreHarness,
} from './session.test-helpers.js';
import { ORG, SESSION } from './token.test-helpers.js';

const KEYS = evidenceKeys(ORG, SESSION);
/** 250 ms between batches keeps every test under the 5 batches/s limit. */
const STEP_MS = 250;

const storedCount = (kv: MapKv) => [...kv.list({ prefix: 'ev:' })].length;
const storedKinds = (kv: MapKv) =>
  [...kv.list<{ body: { kind: string } }>({ prefix: 'ev:' })].map(([, e]) => e.body.kind);

const send = async (h: CoreHarness, streamId: string, events: ClientEvent[]) => {
  h.clock.ms += STEP_MS;
  return h.core.events(AUTH, { streamId, events });
};

// The cap tests build tens of thousands of events; a slow CI runner needs more than the 5 s default
// (Linux CI run 39376126213 timed out at 5.3 s). The assertions are unchanged.
const HEAVY_MS = 30_000;

const batchOf = (from: number, n: number, make: (seq: number) => ClientEvent) =>
  Array.from({ length: n }, (_, k) => make(from + k));

describe('heartbeat thinning (SEC-C1b-2)', () => {
  it(
    'a heartbeat flood past the event cap: acks advance, stored heartbeats stay bounded, finalise succeeds',
    async () => {
      const h = await coreHarness();
      const { view } = await startCore(h);
      const t0 = h.clock.ms;
      let seq = 0;
      // 300 s of the object's time at 4 batches/s of 100 heartbeats: 120 000 heartbeats, past the 50 000 event cap.
      while (h.clock.ms - t0 < 300_000) {
        const out = await send(
          h,
          view.streamId,
          batchOf(seq + 1, 100, (s) => heartbeat(s)),
        );
        seq += 100;
        expect(out).toMatchObject({ ok: true, ackSeq: seq });
      }
      expect(seq).toBeGreaterThan(MAX_STORED_EVENTS);
      const elapsed = h.clock.ms - t0;
      const bound = HEARTBEAT_BURST + Math.ceil(elapsed / HEARTBEAT_STORE_EVERY_MS) + 1;
      expect(storedCount(h.kv)).toBeLessThanOrEqual(bound);
      expect(new Set(storedKinds(h.kv))).toEqual(new Set(['heartbeat']));
      // Dedupe still holds: a resend of acknowledged seqs is ignored and acks the same high-water mark.
      expect(await send(h, view.streamId, [heartbeat(seq - 1), heartbeat(seq)])).toMatchObject({
        ok: true,
        ackSeq: seq,
      });
      // Answers and signals are never thinned.
      expect(
        await send(h, view.streamId, [
          text(seq + 1, WRITTEN, 0, 0, 'kept'),
          paste(seq + 2, WRITTEN, 4),
        ]),
      ).toMatchObject({ ok: true, ackSeq: seq + 2 });

      h.clock.ms += STEP_MS;
      const done = await h.core.submit(AUTH, { streamId: view.streamId, finalSeq: seq + 2 });
      expect(done.ok).toBe(true);
      expect(h.queue.sent).toHaveLength(1);
      const ndjson = objectText(h.evidence, KEYS.events);
      expect(ndjson.split('\n').filter((l) => l !== '')).toHaveLength(storedCount(h.kv) - 1);
      expect(ndjson.length).toBeLessThan(bound * 200);
      // The flood left no connectivity gap: the stored heartbeats still cover every 10 s window of it.
      expect(h.queue.sent[0]?.gaps).toEqual([]);
      expect(h.queue.sent[0]?.lastEventSeq).toBe(storedCount(h.kv));
    },
    HEAVY_MS,
  );

  it('an honest client (one heartbeat every 10 s) has every heartbeat stored', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    for (let seq = 1; seq <= 60; seq += 1) {
      h.clock.ms += 10_000;
      expect(
        await h.core.events(AUTH, { streamId: view.streamId, events: [heartbeat(seq)] }),
      ).toMatchObject({ ok: true, ackSeq: seq });
    }
    expect(storedCount(h.kv)).toBe(60);
  });

  it('a batch of only thinned heartbeats is acknowledged and stores nothing', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    h.clock.ms += 1000;
    await h.core.events(AUTH, {
      streamId: view.streamId,
      events: batchOf(1, HEARTBEAT_BURST, (s) => heartbeat(s)),
    });
    expect(storedCount(h.kv)).toBe(HEARTBEAT_BURST);

    h.clock.ms += 1000;
    const out = await h.core.events(AUTH, {
      streamId: view.streamId,
      events: batchOf(HEARTBEAT_BURST + 1, 5, (s) => heartbeat(s)),
    });
    expect(out).toMatchObject({ ok: true, ackSeq: HEARTBEAT_BURST + 5 });
    expect(storedCount(h.kv)).toBe(HEARTBEAT_BURST);
    // 5 s of the object's time later one more heartbeat is stored.
    h.clock.ms += HEARTBEAT_STORE_EVERY_MS;
    await h.core.events(AUTH, {
      streamId: view.streamId,
      events: batchOf(HEARTBEAT_BURST + 6, 3, (s) => heartbeat(s)),
    });
    expect(storedCount(h.kv)).toBe(HEARTBEAT_BURST + 1);
  });
});

describe('the stored-event cap (SEC-C1b-2)', () => {
  it(
    'a batch that would pass 50 000 stored events is refused whole with too_large; nothing of it is kept',
    async () => {
      const h = await coreHarness();
      const { view } = await startCore(h);
      let seq = 0;
      const target = MAX_STORED_EVENTS - 50;
      while (seq < target) {
        const n = Math.min(100, target - seq);
        const out = await send(
          h,
          view.streamId,
          batchOf(seq + 1, n, (s) => paste(s, WRITTEN, 3)),
        );
        seq += n;
        expect(out).toMatchObject({ ok: true, ackSeq: seq });
      }
      expect(storedCount(h.kv)).toBe(target);
      // 50 left: a batch of 60 crosses the cap. Nothing is stored and the high-water mark does not move.
      const crossing = await send(
        h,
        view.streamId,
        batchOf(seq + 1, 60, (s) => paste(s, WRITTEN, 3)),
      );
      expect(crossing).toEqual({ ok: false, error: 'too_large' });
      expect(storedCount(h.kv)).toBe(seq);
      // A batch that fits is still accepted, up to the cap exactly; then the next stored event is refused.
      const fits = await send(
        h,
        view.streamId,
        batchOf(seq + 1, 50, (s) => paste(s, WRITTEN, 3)),
      );
      expect(fits).toMatchObject({ ok: true, ackSeq: seq + 50 });
      seq += 50;
      expect(storedCount(h.kv)).toBe(MAX_STORED_EVENTS);
      expect(await send(h, view.streamId, [paste(seq + 1, WRITTEN, 3)])).toEqual({
        ok: false,
        error: 'too_large',
      });
      expect(storedCount(h.kv)).toBe(MAX_STORED_EVENTS);

      // The count lives in the object's storage: a restarted object on the same storage still refuses.
      const restarted = new SessionCore({
        kv: h.kv,
        transaction: mapTransaction(h.kv),
        alarm: { set: () => undefined, clear: () => undefined },
        packages: { get: () => Promise.resolve(null) },
        evidence: { put: () => Promise.resolve() },
        mirror: { send: () => Promise.resolve() },
        log: createLogger({ service: 'edge', version: 'dev', sink: () => undefined }),
        now: () => h.clock.ms,
      });
      h.clock.ms += STEP_MS;
      expect(
        await restarted.events(AUTH, {
          streamId: view.streamId,
          events: [paste(seq + 1, WRITTEN, 3)],
        }),
      ).toEqual({ ok: false, error: 'too_large' });
      expect(storedCount(h.kv)).toBe(MAX_STORED_EVENTS);

      // Finalise over the full session still works.
      h.clock.ms += STEP_MS;
      expect((await h.core.submit(AUTH, { streamId: view.streamId, finalSeq: seq })).ok).toBe(true);
      expect(h.queue.sent).toHaveLength(1);
    },
    HEAVY_MS,
  );

  it('over HTTP the refusal is 413 {error: too_large}, never cached', async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    const fake = h.session.sessions.values().next().value;
    if (fake === undefined) throw new Error('no session');
    // Bring the stored counts in the object's storage to one event under the cap.
    const meta = fake.kv.get<Record<string, unknown>>('meta');
    fake.kv.put('meta', { ...meta, stored: { events: MAX_STORED_EVENTS - 1, bytes: 0 } });
    const res = await postEvents(h, token, view.streamId, [
      paste(1, WRITTEN, 3),
      paste(2, WRITTEN, 3),
    ]);

    expect(res.status).toBe(413);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({ error: 'too_large' });
    expect(storedCount(fake.kv)).toBe(0);
  });
});

describe('the stored-byte cap (SEC-C1b-2)', () => {
  it(
    'a batch that would pass 20 MB of stored event bytes is refused whole; UTF-8 bytes are counted',
    async () => {
      const h = await coreHarness();
      const { view } = await startCore(h);
      await serveCore(h, [WRITTEN]);
      // 10 000 three-byte characters: within maxChars (UTF-16 units), about 30 KB of stored UTF-8 per event.
      const big = '€'.repeat(10_000);
      let seq = 0;
      const edit = (s: number) => text(s, WRITTEN, 0, s === 1 ? 0 : big.length, big);
      let refused: unknown = null;
      let before = 0;
      // 20 batches of ~3 MB is well past the cap; the guard keeps an unbounded store from looping forever.
      for (let guard = 0; refused === null && guard < 20; guard += 1) {
        before = storedCount(h.kv);
        const out = await send(h, view.streamId, batchOf(seq + 1, 100, edit));
        if (out.ok) seq += 100;
        else refused = out;
      }
      expect(refused).toEqual({ ok: false, error: 'too_large' });
      expect(storedCount(h.kv)).toBe(before);
      // Over 17 MB was stored before the refusal, and fewer than 1 000 events: the cap counted UTF-8 bytes (counting
      // UTF-16 units would have allowed about three times as many events).
      expect(before).toBeLessThan(1000);
      expect(before * big.length * 3).toBeGreaterThan(17 * 1024 * 1024);
      expect(before * big.length * 3).toBeLessThanOrEqual(MAX_STORED_EVENT_BYTES);
      expect(seq).toBe(before);

      // The answer state did not move with the refused batch: the next small edit applies to the stored text.
      h.clock.ms += STEP_MS;
      const small = await h.core.events(AUTH, {
        streamId: view.streamId,
        events: [text(seq + 1, WRITTEN, big.length, 0, '')],
      });
      expect(small).toMatchObject({ ok: true, ackSeq: seq + 1 });
      // R5-59 b: the edit lands only at a served position, so it must not be refused (re-review Low).
      expect(small).not.toHaveProperty('refusedSeqs');
      h.clock.ms += STEP_MS;
      expect((await h.core.submit(AUTH, { streamId: view.streamId, finalSeq: seq + 1 })).ok).toBe(
        true,
      );
      expect(h.queue.sent[0]?.replay).toBe('ok');
    },
    HEAVY_MS,
  );
});
