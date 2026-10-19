// The event outbox (specs/d1-demo-slice.md §4.4, §4.7, RT-1, RT-2, RT-3, RT-5, RT-13): batches every 2 s, a
// heartbeat every 10 s, resend from `ackSeq + 1`, backoff 1 → 10 s, batches under the 64 KB body cap, offline after a
// 503 or a network failure, unacknowledged events kept for at most 10 minutes. A fake edge applies the SessionDO's
// rules (high-water dedupe, gap → 409, a bad edit refuses the whole batch with 400) so the tests check that what the
// server rebuilds equals what the candidate sees.
import { ClientEvent, EventBatchReq } from '@trace/shared/contracts/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '../api';
import type { EventBatchAck, EventBatchReq as BatchReq } from '@trace/shared/contracts/candidate';
import { isStorableText } from '../text';
import { createOutbox, OUTBOX, type Outbox, type OutboxEvents } from './outbox';
import { applySplice } from './splice';

const STREAM = '22222222-2222-4222-8222-222222222222';
const T0 = Date.parse('2026-10-19T10:00:00.000Z');
const DEADLINE = T0 + 30 * 60_000;
const MAX = 2000;

type Mode =
  | { kind: 'ok' }
  | { kind: 'network' }
  | { kind: 'status'; code: string; status: number; retryAfterSeconds?: number };

/** A fake edge with the SessionDO's stream rules for one written item (2) and one MCQ item (1). */
const fakeEdge = () => {
  const state = {
    hw: 0,
    texts: new Map<number, string>(),
    choices: new Map<number, string | null>(),
    stored: [] as ClientEvent[],
    requests: [] as BatchReq[],
    bodies: [] as string[],
    mode: { kind: 'ok' } as Mode,
    /** When set, the next request is answered with this once. */
    once: undefined as Mode | undefined,
    /** Server clock offset from the fake wall clock. */
    skewMs: 0,
    /** Store events only up to this seq, then answer 409 (a gap). */
    acceptOnly: undefined as number | undefined,
    /** Store the batch, then fail as if the answer was lost (a network failure). */
    loseAnswer: false,
  };
  const events = vi.fn(
    async (_token: string, batch: BatchReq): Promise<ApiResult<EventBatchAck>> => {
      state.requests.push(structuredClone(batch));
      state.bodies.push(JSON.stringify(batch));
      const mode = state.once ?? state.mode;
      state.once = undefined;
      if (mode.kind === 'network') return { ok: false, code: 'network', status: 0 };
      if (mode.kind === 'status') {
        return {
          ok: false,
          code: mode.code as 'unavailable',
          status: mode.status,
          ...(mode.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: mode.retryAfterSeconds }),
        };
      }
      // The contract the edge parses before the DO sees the batch.
      if (!EventBatchReq.safeParse(batch).success)
        return { ok: false, code: 'bad_request', status: 400 };
      if (new TextEncoder().encode(JSON.stringify(batch)).length > 64 * 1024)
        return { ok: false, code: 'too_large', status: 413 };
      let hw = state.hw;
      const texts = new Map(state.texts);
      const choices = new Map(state.choices);
      const accepted: ClientEvent[] = [];
      let gap = false;
      for (const ev of batch.events) {
        if (ev.seq <= hw) continue;
        if (ev.seq !== hw + 1 || (state.acceptOnly !== undefined && ev.seq > state.acceptOnly)) {
          gap = true;
          break;
        }
        if (ev.kind === 'answer.text') {
          if (ev.item !== 2) return { ok: false, code: 'bad_request', status: 400 };
          const next = applySplice(texts.get(ev.item) ?? '', ev);
          if (next === null || next.length > MAX || !isStorableText(next))
            return { ok: false, code: 'bad_request', status: 400 };
          if (ev.len !== undefined && ev.len !== next.length) throw new Error('len mismatch');
          texts.set(ev.item, next);
        }
        if (ev.kind === 'answer.choice') {
          if (ev.item !== 1 || (ev.option !== null && !['a', 'b'].includes(ev.option)))
            return { ok: false, code: 'bad_request', status: 400 };
          choices.set(ev.item, ev.option);
        }
        accepted.push(ev);
        hw = ev.seq;
      }
      state.hw = hw;
      state.texts = texts;
      state.choices = choices;
      state.stored.push(...accepted);
      if (state.loseAnswer) return { ok: false, code: 'network', status: 0 };
      if (gap) return { ok: false, code: 'out_of_order', status: 409, ackSeq: hw };
      return {
        ok: true,
        value: {
          ackSeq: hw,
          serverNow: new Date(Date.now() + state.skewMs).toISOString(),
          deadlineAt: new Date(DEADLINE).toISOString(),
          state: 'in_progress',
        },
      };
    },
  );
  return { state, events };
};

let edge: ReturnType<typeof fakeEdge>;
let outbox: Outbox;
let seen: {
  status: string[];
  reverts: unknown[];
  acks: number[];
  offsets: number[];
  ends: string[];
};

const make = (initialTexts: [number, string][] = []) => {
  const on: OutboxEvents = {
    status: (s) => seen.status.push(s),
    revert: (item, value) => seen.reverts.push({ item, ...value }),
    ack: (info) => {
      seen.acks.push(info.ackSeq);
      seen.offsets.push(info.offsetMs);
    },
    end: (why) => seen.ends.push(why),
  };
  outbox = createOutbox({
    api: { events: edge.events },
    sessionToken: 'fakeSessionHead.fakeSessionBody.fakeSessionSig',
    streamId: STREAM,
    heartbeatSeconds: 10,
    texts: new Map(initialTexts),
    choices: new Map(),
    monoNow: () => Date.now() - T0,
    wallNow: () => Date.now(),
    on,
  });
  return outbox;
};

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  edge = fakeEdge();
  seen = { status: [], reverts: [], acks: [], offsets: [], ends: [] };
});
afterEach(() => {
  outbox.stop();
  vi.useRealTimers();
});

const typeInto = (o: Outbox, values: string[]) => {
  for (const v of values) expect(o.text(2, v, MAX)).toBe(true);
};

describe('batching and the wire shape', () => {
  it('sends nothing before 2 s, then one batch of flat, contract-valid events numbered from 1', async () => {
    const o = make();
    await vi.advanceTimersByTimeAsync(300);
    typeInto(o, ['H', 'He', 'Hey']);
    o.choice(1, 'b');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(edge.events).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(edge.events).toHaveBeenCalledTimes(1);
    const batch = edge.state.requests[0];
    expect(batch?.streamId).toBe(STREAM);
    expect(batch?.events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(batch?.events[0]).toEqual({
      seq: 1,
      t: 300,
      kind: 'answer.text',
      item: 2,
      p: 0,
      d: 0,
      i: 'H',
    });
    expect(batch?.events[3]).toEqual({
      seq: 4,
      t: 300,
      kind: 'answer.choice',
      item: 1,
      option: 'b',
    });
    for (const ev of batch?.events ?? []) expect(ClientEvent.safeParse(ev).success).toBe(true);
    expect(edge.state.texts.get(2)).toBe('Hey');
    expect(seen.acks).toEqual([4]);
    // Nothing is resent once acknowledged.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(edge.events).toHaveBeenCalledTimes(1);
  });

  it('queues a heartbeat every 10 s', async () => {
    make();
    await vi.advanceTimersByTimeAsync(32_500);
    const beats = edge.state.stored.filter((e) => e.kind === 'heartbeat');
    expect(beats.map((e) => e.t)).toEqual([10_000, 20_000, 30_000]);
    expect(edge.state.stored.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('puts `len` on every 25th answer.text event', async () => {
    const o = make();
    const values = Array.from({ length: 60 }, (_, k) => 'x'.repeat(k + 1));
    typeInto(o, values);
    await vi.advanceTimersByTimeAsync(2_000);
    const texts = edge.state.stored.filter((e) => e.kind === 'answer.text');
    expect(texts).toHaveLength(60);
    const withLen = texts.flatMap((e, k) =>
      'len' in e && e.len !== undefined ? [[k + 1, e.len]] : [],
    );
    expect(withLen).toEqual([
      [25, 25],
      [50, 50],
    ]);
  });

  it('refuses an edit whose text is unstorable or over maxChars, and queues nothing for it', async () => {
    const o = make();
    expect(o.text(2, 'ok', MAX)).toBe(true);
    expect(o.text(2, 'ok\u0000', MAX)).toBe(false);
    expect(o.text(2, 'ok\uD83D', MAX)).toBe(false);
    expect(o.text(2, 'x'.repeat(MAX + 1), MAX)).toBe(false);
    expect(o.text(2, 'ok', MAX)).toBe(true); // no change, no event
    await vi.advanceTimersByTimeAsync(2_000);
    expect(edge.state.stored).toHaveLength(1);
    expect(edge.state.texts.get(2)).toBe('ok');
  });

  it('continues from restored text (a reload starts from the view’s answer)', async () => {
    const o = make([[2, 'restored']]);
    expect(o.text(2, 'restored!', MAX)).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(edge.state.requests[0]?.events[0]).toMatchObject({ p: 8, d: 0, i: '!' });
  });

  it('splits batches under the 64 KB body cap and at most 100 events', async () => {
    const o = make();
    // 30 edits that each insert 2 000 three-byte characters (6 000 UTF-8 bytes each): 180 KB in all.
    let value = '';
    for (let k = 0; k < 30; k += 1) {
      value = k % 2 === 0 ? 'ह'.repeat(MAX) : '';
      expect(o.text(2, value, MAX)).toBe(true);
    }
    for (let k = 0; k < 150; k += 1) o.choice(1, k % 2 === 0 ? 'a' : 'b');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(edge.state.requests.length).toBeGreaterThanOrEqual(3);
    for (const body of edge.state.bodies) {
      expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(OUTBOX.maxBodyBytes);
      expect(OUTBOX.maxBodyBytes).toBeLessThan(64 * 1024);
    }
    for (const req of edge.state.requests) expect(req.events.length).toBeLessThanOrEqual(100);
    expect(edge.state.stored).toHaveLength(180 + 1); // + one heartbeat at 10 s
    expect(edge.state.texts.get(2) ?? '').toBe(value);
  });

  it('keeps at most 5 batches a second', async () => {
    const o = make();
    for (let k = 0; k < 400; k += 1) o.choice(1, k % 2 === 0 ? 'a' : 'b');
    await vi.advanceTimersByTimeAsync(2_000);
    const before = edge.events.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(edge.events.mock.calls.length - before).toBeLessThanOrEqual(5);
  });
});

describe('acks and the server clock', () => {
  it('reports the offset serverNow − midpoint(send, receive) at every ack', async () => {
    edge.state.skewMs = 90_000;
    const o = make();
    o.choice(1, 'a');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen.offsets).toEqual([90_000]);
  });

  it('flush sends at once and resolves when everything is acknowledged', async () => {
    const o = make();
    typeInto(o, ['a', 'ab']);
    const done = o.flush();
    await vi.advanceTimersByTimeAsync(10);
    await expect(done).resolves.toBe(true);
    expect(o.ackedSeq()).toBe(2);
    expect(o.pending()).toBe(0);
  });
});

describe('failures', () => {
  it('409 out_of_order: resends from ackSeq + 1 with the same events', async () => {
    const o = make();
    typeInto(o, ['a', 'ab', 'abc']);
    // The edge keeps seq 1 and answers 409 with ackSeq 1 (as after a gap in the stream).
    edge.state.acceptOnly = 1;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(edge.state.requests[0]?.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    edge.state.acceptOnly = undefined;
    await vi.advanceTimersByTimeAsync(500);
    expect(edge.state.requests[1]?.events.map((e) => e.seq)).toEqual([2, 3]);
    expect(edge.state.requests[1]?.events).toEqual(edge.state.requests[0]?.events.slice(1));
    expect(edge.state.texts.get(2)).toBe('abc');
    expect(o.ackedSeq()).toBe(3);
  });

  it('resending a batch the edge already stored is idempotent (seq <= hw is skipped)', async () => {
    const o = make();
    typeInto(o, ['a', 'ab']);
    // The edge stores the batch but the answer is lost on the way back.
    edge.state.loseAnswer = true;
    await vi.advanceTimersByTimeAsync(2_000);
    edge.state.loseAnswer = false;
    expect(edge.state.hw).toBe(2);
    typeInto(o, ['abc']);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(edge.state.texts.get(2)).toBe('abc');
    expect(edge.state.stored.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('a network failure goes offline, keeps the events, backs off 1 → 10 s, and recovers', async () => {
    const o = make();
    edge.state.mode = { kind: 'network' };
    typeInto(o, ['a', 'ab']);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen.status).toEqual(['offline']);
    expect(OUTBOX.offlineMessage).toBe('Offline: your answers are kept on this device');
    const times: number[] = [];
    let n = edge.events.mock.calls.length;
    for (let ms = 0; ms < 60_000; ms += 100) {
      await vi.advanceTimersByTimeAsync(100);
      if (edge.events.mock.calls.length > n) {
        times.push(Date.now() - T0);
        n = edge.events.mock.calls.length;
      }
    }
    const gaps = times.map((t, k) => t - (k === 0 ? 2_000 : (times[k - 1] ?? 0)));
    // 1, 2, 4, 8, 10, 10 … seconds.
    expect(gaps.slice(0, 6)).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000]);
    // Offline retries resend only the batch that may have arrived, never a growing one.
    for (const req of edge.state.requests) expect(req.events.map((e) => e.seq)).toEqual([1, 2]);
    edge.state.mode = { kind: 'ok' };
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seen.status.at(-1)).toBe('online');
    expect(edge.state.texts.get(2)).toBe('ab');
  });

  it('a 503 is offline too', async () => {
    const o = make();
    edge.state.mode = { kind: 'status', code: 'unavailable', status: 503 };
    o.choice(1, 'a');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen.status).toEqual(['offline']);
    expect(o.pending()).toBe(1);
  });

  it('a 429 waits for Retry-After', async () => {
    const o = make();
    edge.state.once = { kind: 'status', code: 'rate_limited', status: 429, retryAfterSeconds: 7 };
    o.choice(1, 'a');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(edge.events).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(edge.events).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(edge.events).toHaveBeenCalledTimes(2);
    expect(edge.state.choices.get(1)).toBe('a');
  });

  it('a 400 drops the batch’s edits, reverts to the last good text, and does not loop (RT-13)', async () => {
    const o = make();
    typeInto(o, ['good']);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(edge.state.texts.get(2)).toBe('good');
    // The edge refuses the next batch (as if its maxChars were smaller than the client's).
    edge.state.once = { kind: 'status', code: 'bad_request', status: 400 };
    typeInto(o, ['good!', 'good!!']);
    o.signal({ sig: 'tab_hidden', item: 2, ms: 4_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen.reverts).toEqual([{ item: 2, text: 'good' }]);
    await vi.advanceTimersByTimeAsync(20_000);
    // The signal of the refused batch is sent again; the edits are gone; nothing loops.
    const after = edge.state.requests.slice(2).flatMap((r) => r.events);
    expect(after.some((e) => e.kind === 'answer.text')).toBe(false);
    expect(after.filter((e) => e.kind === 'signal')).toHaveLength(1);
    expect(edge.state.texts.get(2)).toBe('good');
    expect(edge.events.mock.calls.length).toBeLessThanOrEqual(6);
    // Typing continues from the reverted text.
    expect(o.text(2, 'good?', MAX)).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(edge.state.texts.get(2)).toBe('good?');
  });

  it('a 400 on a batch of signals only drops it (no loop)', async () => {
    const o = make();
    edge.state.mode = { kind: 'status', code: 'bad_request', status: 400 };
    o.signal({ sig: 'fullscreen_exit', item: 1 });
    await vi.advanceTimersByTimeAsync(25_000);
    // The first send and the heartbeat batches each fail once; nothing is retried forever.
    expect(o.pending()).toBe(0);
    expect(seen.ends).toEqual([]);
  });

  it('410 closed ends the stream as "closed"; 401 superseded ends it as "superseded"', async () => {
    let o = make();
    edge.state.mode = { kind: 'status', code: 'closed', status: 410 };
    o.choice(1, 'a');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen.ends).toEqual(['closed']);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(edge.events).toHaveBeenCalledTimes(1);
    o.stop();

    edge = fakeEdge();
    seen.ends = [];
    o = make();
    edge.state.mode = { kind: 'status', code: 'superseded', status: 401 };
    o.choice(1, 'a');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen.ends).toEqual(['superseded']);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(edge.events).toHaveBeenCalledTimes(1);
    await expect(o.flush()).resolves.toBe(false);
  });

  it('SR-4: the 10-minute compaction keeps every signal (only heartbeats and superseded edits go)', async () => {
    const o = make();
    edge.state.mode = { kind: 'network' };
    o.choice(1, 'a');
    await vi.advanceTimersByTimeAsync(60_000);
    o.signal({ sig: 'untrusted_input', item: 2, via: 'input', count: 1 });
    o.signal({ sig: 'paste', item: 2, len: 12 });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    edge.state.mode = { kind: 'ok' };
    await vi.advanceTimersByTimeAsync(30_000);
    const signals = edge.state.stored.filter((e) => e.kind === 'signal');
    expect(signals).toEqual([
      expect.objectContaining({ sig: 'untrusted_input', item: 2, via: 'input', count: 1 }),
      expect.objectContaining({ sig: 'paste', item: 2, len: 12 }),
    ]);
    expect(edge.state.choices.get(1)).toBe('a');
  });

  it('keeps unacknowledged events for at most 10 minutes, without losing the answer text', async () => {
    const o = make();
    edge.state.mode = { kind: 'network' };
    let value = '';
    for (let k = 0; k < 13 * 60; k += 1) {
      value += String.fromCharCode(97 + (k % 26));
      expect(o.text(2, value, MAX)).toBe(true);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    // 13 minutes of typing and heartbeats offline: no unsent event is older than 10 minutes (the one batch that
    // may have reached the edge is kept until the edge answers, so the stream never skips a seq).
    expect(o.oldestUnsentAgeMs()).toBeLessThanOrEqual(10 * 60_000 + OUTBOX.batchEveryMs);
    expect(o.pending()).toBeLessThanOrEqual(2 + 10 * 60 + 10 * 6 + 3);
    edge.state.mode = { kind: 'ok' };
    await vi.advanceTimersByTimeAsync(30_000);
    expect(o.pending()).toBeLessThanOrEqual(1); // at most a heartbeat queued since the last tick
    expect(edge.state.texts.get(2)).toBe(value);
  });
});
