// AT-D26 (shares AT-D7; specs/d1-demo-slice.md §4.4 Timer, §4.8 RT-5): the server-held timer. `started_at` is set once
// from the DO's clock; the deadline is `started_at + duration`; one alarm at `deadline + 60 s` auto-submits (idempotent);
// events are accepted up to the grace boundary and answer 410 `closed` after it; nothing the client sends moves the
// deadline; submit is idempotent and a repeat returns the same receipt. The logic runs on SessionCore over fakes; the
// routes run through the real app.
import { SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import { describe, expect, it } from 'vitest';
import { GRACE_MS } from './session-core.js';
import {
  AUTH,
  coreHarness,
  DURATION_SECONDS,
  heartbeat,
  postEvents,
  sessionHarness,
  startCore,
  startInput,
  text,
  WRITTEN,
  type CoreHarness,
} from './session.test-helpers.js';

const DURATION_MS = DURATION_SECONDS * 1000;

const meta = (h: CoreHarness) => {
  const stored = h.kv.get<{ state: string; startedAt: number; deadlineAt: number }>('meta');
  if (stored === undefined) throw new Error('no session');
  return stored;
};

describe('started_at is set once from the DO clock (AT-D26)', () => {
  it('stamps started_at from its own clock and derives the deadline from it', async () => {
    const h = await coreHarness();
    const t0 = h.clock.ms;
    const { view, startedAt } = await startCore(h);

    expect(startedAt).toBe(new Date(t0).toISOString());
    expect(view.startedAt).toBe(startedAt);
    expect(view.deadlineAt).toBe(new Date(t0 + DURATION_MS).toISOString());
    expect(h.alarm.at).toBe(t0 + DURATION_MS + GRACE_MS);
  });

  it('a later start (resume) keeps started_at and the deadline, whatever the grant says', async () => {
    const h = await coreHarness();
    const first = await startCore(h);
    h.clock.ms += 300_000;
    const again = await startCore(h, {
      nonce: 'session-nonce-0002-abcdef',
      grantStartedAt: new Date(h.clock.ms - 1000).toISOString(),
    });

    expect(again.startedAt).toBe(first.startedAt);
    expect(again.view.deadlineAt).toBe(first.view.deadlineAt);
    expect(again.view.streamId).not.toBe(first.view.streamId);
  });

  it('the route passes the DO value to sessionStarted, and a resume passes the same value again', async () => {
    const h = await sessionHarness();
    const first = await h.startSession();
    h.clock.ms += 120_000;
    const second = await h.startSession();

    const started = h.calls
      .filter((c) => c.method === 'sessionStarted')
      .map((c) => c.input.startedAt);
    expect(started).toEqual([first.view.startedAt, first.view.startedAt]);
    expect(second.view.startedAt).toBe(first.view.startedAt);
    expect(h.api.startedAt).toBe(first.view.startedAt);
  });
});

describe('the deadline alarm and the grace boundary (AT-D26, RT-5)', () => {
  it('accepts events up to deadline + 60 s; one millisecond later the session is closed (410)', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    const deadline = Date.parse(view.deadlineAt);

    h.clock.ms = deadline + GRACE_MS;
    expect(
      await h.core.events(AUTH, { streamId: view.streamId, events: [heartbeat(1)] }),
    ).toMatchObject({
      ok: true,
      ackSeq: 1,
    });
    h.clock.ms += 1;
    expect(await h.core.events(AUTH, { streamId: view.streamId, events: [heartbeat(2)] })).toEqual({
      ok: false,
      error: 'closed',
    });
    // A late request finalises the session itself (the alarm may run late): auto_submitted, mirrored once.
    expect(meta(h).state).toBe('auto_submitted');
  });

  it('prompts are served up to the deadline only; the grace is for saves in flight (SEC-C1b-4)', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    const deadline = Date.parse(view.deadlineAt);

    h.clock.ms = deadline;
    expect(await h.core.item(AUTH, WRITTEN)).toMatchObject({
      ok: true,
      item: { position: WRITTEN },
    });
    h.clock.ms = deadline + 1;
    expect(await h.core.item(AUTH, WRITTEN)).toEqual({ ok: false, error: 'closed' });
    // An item never served before is not served during the grace either.
    expect(await h.core.item(AUTH, 1)).toEqual({ ok: false, error: 'closed' });
    // Events are still accepted until deadline + 60 s.
    h.clock.ms = deadline + GRACE_MS;
    expect(
      await h.core.events(AUTH, {
        streamId: view.streamId,
        events: [text(1, WRITTEN, 0, 0, 'late save')],
      }),
    ).toMatchObject({ ok: true, ackSeq: 1 });
    expect(meta(h).state).toBe('in_progress');
  });

  it('over HTTP an item read after the deadline is 410 closed', async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    h.clock.ms = Date.parse(view.deadlineAt) + 1;
    const res = await h.request('GET', `/v1/session/items/${WRITTEN}`, { token });

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'closed' });
  });

  it('an alarm before deadline + 60 s changes nothing', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    h.clock.ms = Date.parse(view.deadlineAt) + GRACE_MS - 1;
    await h.core.alarm();

    expect(meta(h).state).toBe('in_progress');
    expect(h.queue.sent).toEqual([]);
    expect(h.alarm.at).toBe(Date.parse(view.deadlineAt) + GRACE_MS);
  });

  it('the alarm auto-submits at deadline + 60 s with the answers saved so far, once', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    h.clock.ms += 1000;
    await h.core.events(AUTH, {
      streamId: view.streamId,
      events: [text(1, WRITTEN, 0, 0, 'saved')],
    });

    const alarmAt = h.alarm.at;
    if (alarmAt === null) throw new Error('no alarm');
    h.clock.ms = alarmAt;
    await h.core.alarm();
    await h.core.alarm();

    expect(meta(h).state).toBe('auto_submitted');
    expect(h.queue.sent).toHaveLength(1);
    const message = SessionMirrorMessage.parse(h.queue.sent[0]);
    expect(message.state).toBe('auto_submitted');
    expect(message.submittedAt).toBe(new Date(alarmAt).toISOString());
    expect(message.deadlineAt).toBe(view.deadlineAt);
    expect(h.alarm.at).toBeNull();
  });

  it('after the auto-submit, events answer 410 closed and attach shows the receipt (HTTP)', async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    const fake = h.session.sessions.values().next().value;
    if (fake === undefined || fake.alarm.at === null) throw new Error('no session alarm');
    h.clock.ms = fake.alarm.at;
    await fake.core.alarm();

    const late = await postEvents(h, token, view.streamId, [heartbeat(1)]);
    expect(late.status).toBe(410);
    expect(await late.json()).toEqual({ error: 'closed' });

    const attached = await h.request('POST', '/v1/session/attach', { token });
    expect(attached.status).toBe(200);
    const shown = ((await attached.json()) as { view: Record<string, unknown> }).view;
    expect(shown.state).toBe('auto_submitted');
    expect(shown.receipt).toEqual({
      receiptRef: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{8}$/),
      submittedAt: new Date(h.clock.ms).toISOString(),
    });
    expect(shown.streamId).toBe(view.streamId);

    const item = await h.request('GET', '/v1/session/items/1', { token });
    expect(item.status).toBe(410);
  });
});

describe('the client cannot extend the time (AT-D26)', () => {
  it('client times, starts and attaches never move the deadline; nothing is accepted after the grace', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    const deadlineAt = view.deadlineAt;

    // A client clock far ahead of the server.
    h.clock.ms += 1000;
    const ack = await h.core.events(AUTH, {
      streamId: view.streamId,
      events: [heartbeat(1, 10 * DURATION_MS)],
    });
    expect(ack).toMatchObject({ ok: true, deadlineAt });

    h.clock.ms += 600_000;
    const resumed = await startCore(h, { nonce: 'session-nonce-0003-abcdef' });
    expect(resumed.view.deadlineAt).toBe(deadlineAt);
    const resumedAuth = { ...AUTH, nonce: 'session-nonce-0003-abcdef' };
    h.clock.ms += 11_000;
    const attached = await h.core.attach(resumedAuth);
    expect(attached.ok && attached.view.deadlineAt).toBe(deadlineAt);

    h.clock.ms = Date.parse(deadlineAt) + GRACE_MS + 5_000;
    const streamId = attached.ok ? attached.view.streamId : '';
    expect(await h.core.events(resumedAuth, { streamId, events: [heartbeat(1, 0)] })).toEqual({
      ok: false,
      error: 'closed',
    });
    expect(await h.core.attach(resumedAuth)).toMatchObject({
      ok: true,
      view: { state: 'auto_submitted' },
    });
  });

  it('a start after deadline + 60 s answers the receipt, never a new timer', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    h.clock.ms = Date.parse(view.deadlineAt) + GRACE_MS + 1;
    const out = await h.core.start({
      ...startInput(h.sha256),
      nonce: 'session-nonce-0004-abcdef',
    });

    expect(out).toMatchObject({ ok: true, kind: 'submitted', startedAt: view.startedAt });
    expect(meta(h).deadlineAt).toBe(Date.parse(view.deadlineAt));
  });

  it('a lost object never restarts the clock: a stored start past the grace is 410 closed', async () => {
    const h = await coreHarness();
    const longAgo = new Date(h.clock.ms - DURATION_MS - GRACE_MS - 1).toISOString();
    const out = await h.core.start(startInput(h.sha256, { grantStartedAt: longAgo }));

    expect(out).toEqual({ ok: false, error: 'closed' });
    expect(h.kv.get('meta')).toBeUndefined();
  });
});

describe('submit is idempotent (AT-D26)', () => {
  it('a repeat returns the same receipt and sends no second mirror', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    h.clock.ms += 1000;
    await h.core.events(AUTH, { streamId: view.streamId, events: [heartbeat(1)] });
    h.clock.ms += 1000;
    const first = await h.core.submit(AUTH, { streamId: view.streamId, finalSeq: 1 });
    h.clock.ms += 5_000;
    const again = await h.core.submit(AUTH, { streamId: view.streamId, finalSeq: 1 });

    expect(first.ok).toBe(true);
    expect(again).toEqual(first);
    expect(h.queue.sent).toHaveLength(1);
    expect(meta(h).state).toBe('submitted');
  });

  it('submit needs every event up to finalSeq on the stream (409 with ackSeq)', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    h.clock.ms += 1000;
    await h.core.events(AUTH, { streamId: view.streamId, events: [heartbeat(1), heartbeat(2)] });

    expect(await h.core.submit(AUTH, { streamId: view.streamId, finalSeq: 3 })).toEqual({
      ok: false,
      error: 'out_of_order',
      ackSeq: 2,
    });
    expect(meta(h).state).toBe('in_progress');
  });

  it('over HTTP: the receipt is exactly {receiptRef, submittedAt}; a repeat is the same; events then are 410', async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    await postEvents(h, token, view.streamId, [heartbeat(1)]);
    h.clock.ms += 2000;
    const res = await h.request('POST', '/v1/session/submit', {
      token,
      json: { streamId: view.streamId, finalSeq: 1 },
    });
    expect(res.status).toBe(200);
    const receipt = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(receipt).sort()).toEqual(['receiptRef', 'submittedAt']);
    expect(receipt.submittedAt).toBe(new Date(h.clock.ms).toISOString());

    h.clock.ms += 2000;
    const again = await h.request('POST', '/v1/session/submit', {
      token,
      json: { streamId: view.streamId, finalSeq: 1 },
    });
    expect(await again.json()).toEqual(receipt);
    const after = await postEvents(h, token, view.streamId, [heartbeat(2)]);
    expect(after.status).toBe(410);
    expect(h.queue.sent).toHaveLength(1);
  });

  it('a submit after the grace (alarm not yet run) is the auto-submit, with the same receipt', async () => {
    const h = await coreHarness();
    const { view } = await startCore(h);
    h.clock.ms = Date.parse(view.deadlineAt) + GRACE_MS + 10;
    const out = await h.core.submit(AUTH, { streamId: view.streamId, finalSeq: 0 });

    expect(out.ok).toBe(true);
    expect(meta(h).state).toBe('auto_submitted');
    expect(out.ok && out.receipt.submittedAt).toBe(new Date(h.clock.ms).toISOString());
  });
});
