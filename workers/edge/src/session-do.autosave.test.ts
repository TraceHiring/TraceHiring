// AT-D24, AT-D25 (shares AT-D7; specs/d1-demo-slice.md §4.4, §4.8 RT-1..RT-4, RT-13; L-14, L-21) and the `maxChars`
// batch rejection of AT-D29. Autosave on the SessionDO: per-stream `seq` dedupe and high-water mark, a gap answers
// 409 with `ackSeq`, an older stream is superseded, resends are idempotent; the session-global `gseq` keeps counting
// across a reload, so a paste right after it is kept with its own number; `events.ndjson` holds only signal and
// heartbeat lines (no answer kind, no text); the final answer is the replay of every edit in `gseq` order and equals
// the incremental state over random splice sequences. The logic runs on SessionCore over a Map-backed KV (the test pool
// has no SESSION binding); the routes run through the real app.
import { EvidenceEventLine, SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { objectText } from './edge.test-helpers.js';
import { evidenceKeys } from './session-core.js';
import {
  AUTH,
  choice,
  coreHarness,
  heartbeat,
  MCQ,
  paste,
  postEvents,
  sessionHarness,
  SHORT,
  SHORT_MAX,
  startCore,
  text,
  WRITTEN,
  type CoreHarness,
} from './session.test-helpers.js';
import { ORG, SESSION } from './token.test-helpers.js';
import type { ClientEvent } from '@trace/shared/contracts/candidate';

const KEYS = evidenceKeys(ORG, SESSION);

/** Sends one batch on the bare core, 250 ms after the previous one (under the 5 batches/s limit). */
const send = async (h: CoreHarness, streamId: string, events: ClientEvent[]) => {
  h.clock.ms += 250;
  return h.core.events(AUTH, { streamId, events });
};

const storedGseqs = (h: CoreHarness) =>
  [...h.kv.list<{ gseq: number }>({ prefix: 'ev:' })].map(([, e]) => e.gseq);

const submitCore = async (h: CoreHarness, streamId: string, finalSeq: number) => {
  h.clock.ms += 250;
  const out = await h.core.submit(AUTH, { streamId, finalSeq });
  if (!out.ok) throw new Error(`submit refused: ${out.error}`);
  return out.receipt;
};

const ndjsonLines = (h: CoreHarness) =>
  objectText(h.evidence, KEYS.events)
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

const finalText = (h: CoreHarness, position: number): string | undefined => {
  const file = JSON.parse(objectText(h.evidence, KEYS.final)) as {
    answers: { position: number; text?: string }[];
  };
  return file.answers.find((a) => a.position === position)?.text;
};

describe('SessionDO events: dedupe, high-water, gaps, streams (AT-D24)', () => {
  it('accepts contiguous events, acks the high-water mark and gives each a session-global gseq', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    const out = await send(h, view.streamId, [
      heartbeat(1),
      text(2, WRITTEN, 0, 0, 'abc'),
      heartbeat(3),
    ]);

    expect(out).toMatchObject({ ok: true, ackSeq: 3, state: 'in_progress' });
    expect(storedGseqs(h)).toEqual([1, 2, 3]);
  });

  it('a resend of seq <= hw is idempotent: no new gseq, the edit is applied once', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    await send(h, view.streamId, [text(1, WRITTEN, 0, 0, 'ab'), text(2, WRITTEN, 2, 0, 'c')]);
    const again = await send(h, view.streamId, [
      text(1, WRITTEN, 0, 0, 'ab'),
      text(2, WRITTEN, 2, 0, 'c'),
      text(3, WRITTEN, 3, 0, 'd'),
    ]);

    expect(again).toMatchObject({ ok: true, ackSeq: 3 });
    expect(storedGseqs(h)).toEqual([1, 2, 3]);
    await submitCore(h, view.streamId, 3);
    expect(finalText(h, WRITTEN)).toBe('abcd');
  });

  it('the first gap stops the batch: out_of_order with ackSeq = hw, the events before it kept', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    const out = await send(h, view.streamId, [
      heartbeat(1),
      heartbeat(2),
      heartbeat(4),
      heartbeat(5),
    ]);

    expect(out).toEqual({ ok: false, error: 'out_of_order', ackSeq: 2 });
    expect(storedGseqs(h)).toEqual([1, 2]);
    // The client resends from ackSeq + 1.
    expect(await send(h, view.streamId, [heartbeat(3), heartbeat(4)])).toMatchObject({
      ok: true,
      ackSeq: 4,
    });
  });

  it('answers 409 out_of_order with ackSeq over HTTP, never cached', async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    const res = await postEvents(h, token, view.streamId, [heartbeat(1), heartbeat(3)]);

    expect(res.status).toBe(409);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({ error: 'out_of_order', ackSeq: 1 });
  });

  it('a reload (attach) supersedes the older stream: its events answer 401 superseded', async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    expect((await postEvents(h, token, view.streamId, [heartbeat(1)])).status).toBe(200);

    const attached = await h.request('POST', '/v1/session/attach', { token });
    expect(attached.status).toBe(200);
    const next = ((await attached.json()) as { view: { streamId: string } }).view.streamId;
    expect(next).not.toBe(view.streamId);

    h.clock.ms += 1000;
    const old = await postEvents(h, token, view.streamId, [heartbeat(2)]);
    expect(old.status).toBe(401);
    expect(await old.json()).toEqual({ error: 'superseded' });
    expect((await postEvents(h, token, next, [heartbeat(1)])).status).toBe(200);
  });

  it('a new login and start supersede the older session token (one active device, Q41)', async () => {
    const h = await sessionHarness();
    const first = await h.startSession();
    h.clock.ms += 31_000;
    const second = await h.startSession();

    const old = await postEvents(h, first.token, first.view.streamId, [heartbeat(1)]);
    expect(old.status).toBe(401);
    expect(await old.json()).toEqual({ error: 'superseded' });
    expect((await postEvents(h, second.token, second.view.streamId, [heartbeat(1)])).status).toBe(
      200,
    );
    expect(second.view.startedAt).toBe(first.view.startedAt);
  });

  it('a stream id the session never issued is 400, and identity keys in the body are ignored', async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    const unknown = await postEvents(h, token, '00000000-0000-4000-8000-0000000000ff', [
      heartbeat(1),
    ]);
    expect(unknown.status).toBe(400);

    h.clock.ms += 1000;
    const res = await h.request('POST', '/v1/session/events', {
      token,
      json: {
        streamId: view.streamId,
        events: [heartbeat(1)],
        invitationId: '55555555-5555-4555-8555-555555555555',
        sessionId: '55555555-5555-4555-8555-555555555555',
      },
    });
    expect(res.status).toBe(200);
    expect(new Set(h.session.names)).toEqual(new Set(['11111111-1111-4111-8111-111111111111']));
  });

  it('caps the batch at 5 per second per session (429 with Retry-After)', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    h.clock.ms += 5_000;
    for (let seq = 1; seq <= 5; seq += 1) {
      expect(
        await h.core.events(AUTH, { streamId: view.streamId, events: [heartbeat(seq)] }),
      ).toMatchObject({
        ok: true,
      });
    }
    expect(await h.core.events(AUTH, { streamId: view.streamId, events: [heartbeat(6)] })).toEqual({
      ok: false,
      error: 'rate_limited',
      retryAfterSeconds: 1,
    });
  });

  it('two streams (L-14): a paste right after a reload gets the next gseq and lands in events.ndjson', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    await send(h, view.streamId, [heartbeat(1), text(2, WRITTEN, 0, 0, 'draft'), heartbeat(3)]);

    const attached = await h.core.attach(AUTH);
    if (!attached.ok) throw new Error('attach refused');
    const stream2 = attached.view.streamId;
    expect(stream2).not.toBe(view.streamId);
    // seq restarts at 1 on the new stream; the paste is not a duplicate of stream 1's seq 1.
    expect(
      await send(h, stream2, [paste(1, WRITTEN, 12), text(2, WRITTEN, 5, 0, ' more')]),
    ).toMatchObject({
      ok: true,
      ackSeq: 2,
    });
    expect(storedGseqs(h)).toEqual([1, 2, 3, 4, 5]);

    await submitCore(h, stream2, 2);
    const lines = ndjsonLines(h);
    for (const line of lines) expect(EvidenceEventLine.safeParse(line).success).toBe(true);
    // gseq is contiguous in the DO, but events.ndjson skips the values taken by answer events (2 and 5).
    expect(lines.map((l) => l.gseq)).toEqual([1, 3, 4]);
    expect(lines[2]).toMatchObject({
      gseq: 4,
      streamId: stream2,
      kind: 'signal',
      sig: 'paste',
      len: 12,
    });

    const message = SessionMirrorMessage.parse(h.queue.sent[0]);
    expect(message.lastEventSeq).toBe(5);
    expect(message.streamCount).toBe(2);
    expect(message.resumeCount).toBe(1);
    expect(finalText(h, WRITTEN)).toBe('draft more');
  });

  it('events.ndjson never holds an answer kind or a text field (L-21)', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    const marker = 'zq-synthetic-answer-marker';
    await send(h, view.streamId, [
      heartbeat(1),
      text(2, WRITTEN, 0, 0, marker),
      choice(3, MCQ, 'b'),
      paste(4, WRITTEN, 5),
      heartbeat(5),
    ]);
    await submitCore(h, view.streamId, 5);

    const raw = objectText(h.evidence, KEYS.events);
    expect(raw).not.toContain(marker);
    expect(raw).not.toContain('answer');
    for (const line of ndjsonLines(h)) {
      expect(['signal', 'heartbeat']).toContain(line.kind);
      for (const key of ['i', 'p', 'd', 'text', 'option', 'choice'])
        expect(line).not.toHaveProperty(key);
    }
    // The answers live in final.json (and the mirror's hash) instead.
    expect(finalText(h, WRITTEN)).toBe(marker);
  });

  it('attach after a reload restores the answers, the timer and the served items (RT-4)', async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    await h.request('GET', `/v1/session/items/${WRITTEN}`, { token });
    await postEvents(h, token, view.streamId, [
      text(1, WRITTEN, 0, 0, 'kept'),
      choice(2, MCQ, 'a'),
    ]);
    h.clock.ms += 30_000;

    const res = await h.request('POST', '/v1/session/attach', { token });
    const restored = ((await res.json()) as { view: Record<string, unknown> }).view;
    expect(restored.answers).toEqual([
      { position: MCQ, choice: 'a' },
      { position: WRITTEN, text: 'kept' },
    ]);
    expect(restored.deadlineAt).toBe(view.deadlineAt);
    expect(restored.serverNow).toBe(new Date(h.clock.ms).toISOString());
    expect(
      (restored.items as { position: number; servedAt: string | null }[])[WRITTEN - 1]?.servedAt,
    ).toBe(new Date(Date.parse(view.serverNow)).toISOString());
  });
});

describe('an invalid edit rejects the whole batch (AT-D29 maxChars, RT-13)', () => {
  it('an answer.text over maxChars is 400 and nothing of the batch is kept', async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    const good = 'x'.repeat(SHORT_MAX - 1);
    expect((await postEvents(h, token, view.streamId, [text(1, SHORT, 0, 0, good)])).status).toBe(
      200,
    );

    h.clock.ms += 1000;
    const over = await postEvents(h, token, view.streamId, [
      heartbeat(2),
      text(3, SHORT, SHORT_MAX - 1, 0, 'yz'),
    ]);
    expect(over.status).toBe(400);
    expect(await over.json()).toEqual({ error: 'bad_request' });

    // hw is still 1: the heartbeat before the bad edit was not kept either; the last good text stands.
    h.clock.ms += 1000;
    const next = await postEvents(h, token, view.streamId, [heartbeat(2)]);
    expect(((await next.json()) as { ackSeq: number }).ackSeq).toBe(2);
    const attached = await h.request('POST', '/v1/session/attach', { token });
    const answers = ((await attached.json()) as { view: { answers: unknown[] } }).view.answers;
    expect(answers).toEqual([{ position: SHORT, text: good }]);
  });

  it('exactly maxChars is accepted', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    expect(
      await send(h, view.streamId, [text(1, SHORT, 0, 0, 'x'.repeat(SHORT_MAX))]),
    ).toMatchObject({
      ok: true,
      ackSeq: 1,
    });
  });

  it.each([
    ['a splice outside the text', [text(1, WRITTEN, 1, 0, 'a')]],
    ['a delete past the end', [text(1, WRITTEN, 0, 0, 'ab'), text(2, WRITTEN, 1, 2, '')]],
    ['text on an MCQ item', [text(1, MCQ, 0, 0, 'a')]],
    ['a choice on a written item', [choice(1, WRITTEN, 'a')]],
    ['an option the item does not have', [choice(1, MCQ, 'zz')]],
    ['an unknown item', [text(1, 9, 0, 0, 'a')]],
    ['a signal on an unknown item', [paste(1, 9, 3)]],
  ])('rejects %s with bad_request', async (_name, events) => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    expect(await send(h, view.streamId, events)).toEqual({ ok: false, error: 'bad_request' });
    expect(storedGseqs(h)).toEqual([]);
  });

  it('a body over 64 KB is 413 before parsing', async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    const big = 'x'.repeat(9_000);
    const events = Array.from({ length: 8 }, (_, k) => text(k + 1, WRITTEN, 0, 0, big));
    const res = await postEvents(h, token, view.streamId, events);
    expect(res.status).toBe(413);
  });
});

// ---- AT-D25: rebuild equals the incremental state ---------------------------------------------------------------

/** fast-check runs a fixed seed and run count, so CI is deterministic and a failure replays from its seed and path. */
const AT_D25_SEED = 20_261_018;
const AT_D25_RUNS = 150;

const ALPHABET = ['a', 'b', 'c', ' ', '\n', 'é', '😀', 'Z'];

/** The splice a client derives from two consecutive textarea values (common prefix and suffix, §4.4). */
const spliceOf = (prev: string, next: string) => {
  let p = 0;
  while (p < prev.length && p < next.length && prev[p] === next[p]) p += 1;
  let s = 0;
  while (
    s < prev.length - p &&
    s < next.length - p &&
    prev[prev.length - 1 - s] === next[next.length - 1 - s]
  ) {
    s += 1;
  }
  return { p, d: prev.length - p - s, i: next.slice(p, next.length - s) };
};

/** One textarea edit: insert, delete or replace a run on one written item (positions are folded into range). */
interface Edit {
  item: number;
  at: number;
  del: number;
  ins: string;
}
const editArb: fc.Arbitrary<Edit> = fc.record({
  item: fc.constantFrom(WRITTEN, SHORT),
  at: fc.nat(),
  del: fc.nat(3),
  ins: fc.array(fc.constantFrom(...ALPHABET), { maxLength: 3 }).map((chars) => chars.join('')),
});

/**
 * One batch: sometimes a reload (attach) first (about 1 in 10), 1 to 5 edits, and sometimes a resend of the last
 * two events already sent on the stream (about 3 in 10, RT-1).
 */
const stepArb = fc.record({
  attach: fc.nat(9).map((n) => n === 0),
  edits: fc.array(editArb, { minLength: 1, maxLength: 5 }),
  resend: fc.nat(9).map((n) => n < 3),
});

/** The independent model: the next textarea value after an edit, at most `max` UTF-16 units. */
const applyEdit = (prev: string, edit: Edit, max: number): string => {
  const at = edit.at % (prev.length + 1);
  const del = Math.min(edit.del, prev.length - at);
  const next = prev.slice(0, at) + edit.ins + prev.slice(at + del);
  // Over the cap: the same edit without its insert (never longer than `prev`, which is within the cap).
  return next.length <= max ? next : prev.slice(0, at) + prev.slice(at + del);
};

describe('final answer = replay of every edit in gseq order (AT-D25)', () => {
  it('equals the incremental state and the client value over random splice sequences, reloads and resends', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 5, maxLength: 29 }), async (steps) => {
        const h = await coreHarness();
        const { view } = await startCore(h);
        let streamId = view.streamId;
        const model = new Map<number, string>([
          [WRITTEN, ''],
          [SHORT, ''],
        ]);
        let seq = 0;
        let sent: ClientEvent[] = [];
        for (const step of steps) {
          if (step.attach) {
            h.clock.ms += 11_000; // attach is limited to 6 per minute
            const attached = await h.core.attach(AUTH);
            if (!attached.ok) throw new Error('attach refused');
            streamId = attached.view.streamId;
            seq = 0;
            sent = [];
          }
          const batch: ClientEvent[] = [];
          for (const edit of step.edits) {
            const prev = model.get(edit.item) ?? '';
            const next = applyEdit(prev, edit, edit.item === SHORT ? SHORT_MAX : 200);
            const { p, d, i } = spliceOf(prev, next);
            seq += 1;
            batch.push(text(seq, edit.item, p, d, i));
            model.set(edit.item, next);
          }
          const resend = step.resend ? sent.slice(-2) : [];
          const out = await send(h, streamId, [...resend, ...batch]);
          if (!out.ok) throw new Error(`batch refused ${JSON.stringify(out)}`);
          sent = [...sent, ...batch];
        }
        await submitCore(h, streamId, seq);
        const message = SessionMirrorMessage.parse(h.queue.sent[0]);
        expect(message.replay).toBe('ok');
        for (const item of [WRITTEN, SHORT]) {
          expect({ item, text: finalText(h, item) ?? '' }).toEqual({
            item,
            text: model.get(item) ?? '',
          });
        }
      }),
      { seed: AT_D25_SEED, numRuns: AT_D25_RUNS },
    );
  });

  it('a drifted incremental state is caught: replay mismatch, and the replay is the final answer', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    await send(h, view.streamId, [text(1, WRITTEN, 0, 0, 'true text')]);
    const stored = h.kv.get<{ kind: 'text'; text: string; gseq: number }>(`ans:${WRITTEN}`);
    if (stored === undefined) throw new Error('no incremental state');
    h.kv.put(`ans:${WRITTEN}`, { ...stored, text: 'drifted' });

    await submitCore(h, view.streamId, 1);
    expect(SessionMirrorMessage.parse(h.queue.sent[0]).replay).toBe('mismatch');
    expect(finalText(h, WRITTEN)).toBe('true text');
  });

  it('a client len check that disagrees with the server text is recorded as replay mismatch (context)', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    const withLen = { ...text(1, WRITTEN, 0, 0, 'abc'), len: 4 } as ClientEvent;
    expect(await send(h, view.streamId, [withLen])).toMatchObject({ ok: true });
    await submitCore(h, view.streamId, 1);
    expect(SessionMirrorMessage.parse(h.queue.sent[0]).replay).toBe('mismatch');
    expect(finalText(h, WRITTEN)).toBe('abc');
  });
});
