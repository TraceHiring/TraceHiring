// AT-D37 (specs/d1-demo-slice.md §4.4 Timer and Coverage, §4.8 RT-10): the DO is the clock authority. A shifted
// client clock (every `t` moved, forwards or backwards) changes no deadline, coverage, gap, signal time or token
// outcome: those use only the DO's and the edge's own clocks. Coverage is counted in 10 s windows of server time; three
// uncovered windows in a row are a connectivity gap; a `tab_hidden` signal covers its reported duration ending at the
// server time it arrived.
import { SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import { describe, expect, it } from 'vitest';
import { objectText } from './edge.test-helpers.js';
import { evidenceKeys } from './session-core.js';
import { computeCoverage, type StoredEvent } from './session-evidence.js';
import {
  AUTH,
  coreHarness,
  heartbeat,
  paste,
  serveCore,
  sessionHarness,
  startCore,
  tabHidden,
  text,
  WRITTEN,
} from './session.test-helpers.js';
import { CANDIDATE, INVITATION, ORG, signToken } from './token.test-helpers.js';
import type { ClientEvent } from '@trace/shared/contracts/candidate';

const KEYS = evidenceKeys(ORG, '44444444-4444-4444-8444-444444444444');

/**
 * One session on a fixed server-time schedule (arrival offsets in ms from the start); the client's `t` for each event
 * is `shift(arrival)`. Returns the mirror message and the events file.
 */
const runSchedule = async (shift: (arrivalMs: number) => number) => {
  const h = await coreHarness();
  const { view } = await startCore(h);
  await serveCore(h, [WRITTEN]);
  const t0 = h.clock.ms;
  // Heartbeats for the first minute, a 70 s silence, a paste, a tab_hidden of 40 s, then heartbeats again.
  const schedule: { at: number; make: (seq: number, t: number) => ClientEvent }[] = [];
  for (let at = 1_000; at <= 60_000; at += 10_000) {
    schedule.push({ at, make: (seq, t) => heartbeat(seq, t) });
  }
  schedule.push({ at: 131_000, make: (seq, t) => paste(seq, WRITTEN, 9, t) });
  schedule.push({ at: 132_000, make: (seq, t) => text(seq, WRITTEN, 0, 0, 'abc', t) });
  schedule.push({ at: 200_000, make: (seq, t) => tabHidden(seq, null, 40_000, t) });
  for (let at = 205_000; at <= 300_000; at += 10_000) {
    schedule.push({ at, make: (seq, t) => heartbeat(seq, t) });
  }
  let seq = 0;
  for (const { at, make } of schedule) {
    h.clock.ms = t0 + at;
    seq += 1;
    const out = await h.core.events(AUTH, {
      streamId: view.streamId,
      events: [make(seq, Math.max(0, shift(at)))],
    });
    if (!out.ok) throw new Error(`refused at ${at}: ${out.error}`);
    expect(out).not.toHaveProperty('refusedSeqs');
    expect(out.serverNow).toBe(new Date(h.clock.ms).toISOString());
    expect(out.deadlineAt).toBe(view.deadlineAt);
  }
  h.clock.ms = t0 + 310_000;
  const done = await h.core.submit(AUTH, { streamId: view.streamId, finalSeq: seq });
  if (!done.ok) throw new Error('submit refused');
  const message = SessionMirrorMessage.parse(h.queue.sent[0]);
  const lines = objectText(h.evidence, KEYS.events)
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { message, lines, t0 };
};

const withoutClientTimes = (lines: Record<string, unknown>[]) =>
  lines.map((line) => Object.fromEntries(Object.entries(line).filter(([key]) => key !== 't')));

describe('a shifted client clock changes nothing the server decides (AT-D37)', () => {
  it('deadline, coverage, gaps and signal times are the same for an honest, a fast and a slow client clock', async () => {
    const honest = await runSchedule((at) => at);
    const ahead = await runSchedule((at) => at + 3 * 60 * 60 * 1000);
    const behind = await runSchedule((at) => Math.floor(at / 7));

    for (const run of [ahead, behind]) {
      expect(run.message.deadlineAt).toBe(honest.message.deadlineAt);
      expect(run.message.startedAt).toBe(honest.message.startedAt);
      expect(run.message.coverage).toEqual(honest.message.coverage);
      expect(run.message.gaps).toEqual(honest.message.gaps);
      expect(withoutClientTimes(run.lines)).toEqual(withoutClientTimes(honest.lines));
    }
    // The client times are kept, as context only.
    expect(ahead.lines.map((l) => l.t)).not.toEqual(honest.lines.map((l) => l.t));
  });

  it('coverage counts 10 s windows of server time; the silence is one connectivity gap', async () => {
    const { message, t0 } = await runSchedule((at) => at);
    const iso = (ms: number) => new Date(t0 + ms).toISOString();

    // Active time is start to submit (310 s): 31 windows. Covered: windows 0-5 (heartbeats), 13 (paste and text),
    // 16-19 (tab_hidden 160-200 s), 20-29 (heartbeats at 205-295 s); uncovered: 6-12, 14-15, 30.
    expect(message.coverage).toEqual({ activeMs: 310_000, coveredMs: 21 * 10_000 });
    expect(message.gaps).toEqual([{ from: iso(60_000), to: iso(130_000), label: 'connectivity' }]);
  });

  it('the events file carries the DO acceptance time and the gseq, the client t only as context', async () => {
    const { lines, t0 } = await runSchedule((at) => at + 999);
    const paste = lines.find((l) => l.sig === 'paste');
    expect(paste).toMatchObject({ tServer: new Date(t0 + 131_000).toISOString(), t: 131_999 });
  });
});

describe('computeCoverage', () => {
  const ev = (tServer: number, body: StoredEvent['body'] = { kind: 'heartbeat' }): StoredEvent => ({
    gseq: 1,
    streamId: 's',
    seq: 1,
    t: 0,
    tServer,
    body,
  });

  it('ignores events outside the active time and clips the last partial window', () => {
    const out = computeCoverage(0, 25_000, [ev(-5), ev(21_000), ev(25_000), ev(90_000)]);
    expect(out).toEqual({ activeMs: 25_000, coveredMs: 5_000, gaps: [] });
  });

  it('needs three uncovered windows in a row for a gap', () => {
    expect(computeCoverage(0, 60_000, [ev(0), ev(30_000)]).gaps).toEqual([]);
    expect(computeCoverage(0, 60_000, [ev(0), ev(45_000)]).gaps).toEqual([
      { from: 10_000, to: 40_000 },
    ]);
    expect(computeCoverage(0, 60_000, [ev(0)]).gaps).toEqual([{ from: 10_000, to: 60_000 }]);
  });

  it('a tab_hidden interval covers the windows it overlaps, clamped to the session', () => {
    const hidden = ev(50_000, { kind: 'signal', sig: 'tab_hidden', item: null, ms: 1_000_000 });
    expect(computeCoverage(0, 60_000, [hidden])).toEqual({
      activeMs: 60_000,
      coveredMs: 60_000,
      gaps: [],
    });
  });
});

describe('token outcomes use the server clock only (AT-D37)', () => {
  it('a client Date header never rescues an expired session token nor expires a valid one', async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    const farPast = { date: 'Mon, 01 Jan 2001 00:00:00 GMT' };
    const farFuture = { date: 'Fri, 01 Jan 2100 00:00:00 GMT' };

    const ok = await h.request('POST', '/v1/session/events', {
      token,
      json: { streamId: view.streamId, events: [heartbeat(1)] },
      headers: farFuture,
    });
    expect(ok.status).toBe(200);

    const iat = Math.floor(h.clock.ms / 1000) - 7200;
    const expired = await signToken(h.key, {
      sub: CANDIDATE,
      candidate_id: CANDIDATE,
      invitation_id: INVITATION,
      org_id: ORG,
      typ: 'session',
      nonce: 'session-nonce-0001-abcdef',
      iat,
      exp: iat + 3600,
    });
    const res = await h.request('POST', '/v1/session/attach', { token: expired, headers: farPast });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'token_expired' });
  });
});
