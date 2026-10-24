// The candidate's event outbox (specs/d1-demo-slice.md §4.4, §4.7; RT-1, RT-2, RT-3, RT-5, RT-13). One outbox per
// stream (a start or attach opens a new stream, `seq` from 1). Answer edits, choices, signals and a heartbeat every
// `heartbeatSeconds` are queued and sent as one batch every 2 s (at most 100 events and under the 64 KB body cap,
// at most 4 batches a second, inside the edge's 5/s). The edge's high-water mark makes resends idempotent: an
// acknowledged event leaves the queue, a 409 resends from `ackSeq + 1`, and a batch that may have reached the edge
// (a network failure) is resent with the same numbers and content, never renumbered.
//
// Offline (a network failure, 503 or an answer that fits no contract): "Offline: your answers are kept on this
// device", retry after 1, 2, 4, 8, then every 10 s. Unsent answer edits and heartbeats are kept for at most 10
// minutes; older edits are replaced by one edit per item from the last text the edge may hold to the current text,
// so the answer is never lost, and every signal is kept (SR-4). A 400 or 413 refuses the whole batch (nothing of it was stored): its answer edits are dropped, the items go
// back to the last acknowledged text (RT-13) and the batch's signals are sent once more; it never loops.
// 410 ends the stream as `closed` (the caller attaches for the receipt), 401 `superseded` as `superseded`.
// M1 (R5-20, R5-45, R5-66 f): an ack's `refusedSeqs` are acknowledged like the rest (they leave the queue), but a
// refused answer never counts as kept: its item goes back to what the edge holds through `revert`, and the unsent
// edits of that item queued behind it are dropped (they were built on the refused text). `section.finish` is an
// event like a signal: compaction and a refused batch keep it. `enqueuedSeq` is the `afterSeq` of a v2 item GET.
// Events carry metadata only; nothing here logs.
import type { ClientEvent, ClientSignal, SessionState } from '@trace/shared/contracts/candidate';
import { isOffline, type ApiFailure, type CandidateApi } from '../api';
import { OFFLINE_MESSAGE } from '../copy';
import { isStorableText } from '../text';
import { applySplice, spliceOf } from './splice';

export const OUTBOX = {
  batchEveryMs: 2_000,
  /** Spacing between batches: at most 4 a second (the edge allows 5). */
  minGapMs: 250,
  maxEvents: 100,
  /** The edge refuses a body over 64 KiB; this leaves room for the envelope and rounding. */
  maxBodyBytes: 60_000,
  backoffMs: [1_000, 2_000, 4_000, 8_000, 10_000],
  keepUnsentMs: 10 * 60_000,
  lenEvery: 25,
  offlineMessage: OFFLINE_MESSAGE,
} as const;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Body = DistributiveOmit<ClientEvent, 'seq' | 't'>;
/** A signal as the signals module reports it: the §4.6 payload without the envelope. */
export type SignalBody = DistributiveOmit<ClientSignal, 'seq' | 't' | 'kind'>;

interface Entry {
  body: Body;
  /** Client offset (ms since the stream opened) stamped when queued. */
  t: number;
  /** Monotonic time it was queued. */
  at: number;
  /** Set once the entry was part of a request; from then on its number and content never change. */
  seq?: number;
}

export interface AckInfo {
  ackSeq: number;
  serverNowMs: number;
  deadlineAtMs: number;
  /** `serverNow − midpoint(send, receive)`: add to Date.now() to read the server clock. */
  offsetMs: number;
  state: SessionState;
}

export type EndReason = 'closed' | 'superseded' | 'invalid';

export interface OutboxEvents {
  status(status: 'online' | 'offline'): void;
  /** The edge refused an edit: show this last acknowledged value again. */
  revert(item: number, value: { text: string } | { choice: string | null }): void;
  ack(info: AckInfo): void;
  /** The stream is over; the outbox has stopped. */
  end(reason: EndReason): void;
}

export interface OutboxDeps {
  api: Pick<CandidateApi, 'events'>;
  sessionToken: string;
  streamId: string;
  heartbeatSeconds: number;
  /** The answers the edge holds at the stream's start (the view). */
  texts: ReadonlyMap<number, string>;
  choices: ReadonlyMap<number, string | null>;
  /** Monotonic ms (performance.now): event `t` values and the outbox's own timing. */
  monoNow?: () => number;
  /** Wall-clock ms (Date.now): only for the server-clock midpoint. */
  wallNow?: () => number;
  on: OutboxEvents;
}

export interface Outbox {
  /** Queues the edit from the item's current text to `next`; false (nothing queued) if `next` may not be stored. */
  text(item: number, next: string, maxChars: number): boolean;
  choice(item: number, option: string | null): void;
  signal(signal: SignalBody): void;
  /** Queues `section.finish` (v2 sessions): the candidate leaves the section for good (R5-59 e). */
  finish(sectionId: string): void;
  /** Sends now; true once everything queued before the call is acknowledged, false if offline or ended. */
  flush(): Promise<boolean>;
  ackedSeq(): number;
  /** The highest seq the outbox has enqueued: the acknowledged seq plus every queued event (R5-45, R5-66 f). */
  enqueuedSeq(): number;
  pending(): number;
  oldestUnsentAgeMs(): number;
  stop(): void;
}

/** Events never compacted away nor dropped with a refused batch's edits: signals (SR-4) and `section.finish`. */
const keptAlways = (b: Body): boolean => b.kind === 'signal' || b.kind === 'section.finish';

const encoder = new TextEncoder();
const bytesOf = (value: unknown): number => encoder.encode(JSON.stringify(value)).length;

const ENDS: Partial<Record<ApiFailure['code'], EndReason>> = {
  closed: 'closed',
  link_expired: 'closed',
  link_revoked: 'closed',
  superseded: 'superseded',
  token_invalid: 'invalid',
  token_expired: 'invalid',
  not_eligible: 'invalid',
  step_required: 'invalid',
  invalid_link: 'invalid',
  otp_wrong: 'invalid',
};

export const createOutbox = (deps: OutboxDeps): Outbox => {
  const mono = deps.monoNow ?? (() => performance.now());
  const wall = deps.wallNow ?? (() => Date.now());
  const { on } = deps;
  const opened = mono();
  const envelope = bytesOf({ streamId: deps.streamId, events: [] });

  const confirmed = new Map(deps.texts);
  const current = new Map(deps.texts);
  const confirmedChoice = new Map(deps.choices);
  const currentChoice = new Map(deps.choices);

  let queue: Entry[] = [];
  let acked = 0;
  let textCount = 0;
  let inFlight = false;
  let stopped = false;
  let offline = false;
  let failures = 0;
  let notBefore = -Infinity;
  let lastSentAt = -Infinity;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let waiters: { until: number; resolve: (ok: boolean) => void }[] = [];

  const elapsed = () => Math.max(0, Math.round(mono() - opened));
  const enqueue = (body: Body) => {
    if (!stopped) queue.push({ body, t: elapsed(), at: mono() });
  };
  const wire = (e: Entry, seq: number): ClientEvent => ({ seq, t: e.t, ...e.body }) as ClientEvent;

  const enqueueText = (item: number, prev: string, next: string) => {
    const { p, d, i } = spliceOf(prev, next);
    textCount += 1;
    enqueue({
      kind: 'answer.text',
      item,
      p,
      d,
      i,
      ...(textCount % OUTBOX.lenEvery === 0 ? { len: next.length } : {}),
    });
  };

  /** Applies an entry to a text and choice state (the edge's rule: a splice that does not fit leaves the text). */
  const applyTo = (texts: Map<number, string>, choices: Map<number, string | null>, b: Body) => {
    if (b.kind === 'answer.text') {
      const before = texts.get(b.item) ?? '';
      texts.set(b.item, applySplice(before, b) ?? before);
    } else if (b.kind === 'answer.choice') choices.set(b.item, b.option);
  };

  const settleWaiters = (ok: boolean | null) => {
    waiters = waiters.filter((w) => {
      if (ok === false) {
        w.resolve(false);
        return false;
      }
      if (!queue.some((e) => e.at <= w.until)) {
        w.resolve(true);
        return false;
      }
      return true;
    });
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(tick);
    clearInterval(beat);
    if (retry !== undefined) clearTimeout(retry);
    settleWaiters(false);
  };

  const end = (reason: EndReason) => {
    stop();
    on.end(reason);
  };

  const later = (ms: number) => {
    if (stopped) return;
    if (retry !== undefined) clearTimeout(retry);
    retry = setTimeout(
      () => {
        retry = undefined;
        void pump();
      },
      Math.max(0, ms),
    );
  };

  const ackTo = (seq: number, refused: ReadonlySet<number> = new Set()) => {
    const refusedTexts = new Set<number>();
    const refusedChoices = new Set<number>();
    while (queue.length > 0) {
      const head = queue[0];
      if (head?.seq === undefined || head.seq > seq) break;
      queue.shift();
      if (!refused.has(head.seq)) applyTo(confirmed, confirmedChoice, head.body);
      else if (head.body.kind === 'answer.text') refusedTexts.add(head.body.item);
      else if (head.body.kind === 'answer.choice') refusedChoices.add(head.body.item);
    }
    if (seq > acked) acked = seq;
    if (refusedTexts.size + refusedChoices.size > 0) undoRefused(refusedTexts, refusedChoices);
  };

  /**
   * R5-20, R5-66 f: the edge kept none of these items' refused edits. Their unsent edits (built on the refused text)
   * are dropped; edits already numbered stay (a seq never changes) and are replayed on what the edge holds.
   */
  const undoRefused = (texts: ReadonlySet<number>, choices: ReadonlySet<number>) => {
    queue = queue.filter(
      (e) =>
        e.seq !== undefined ||
        !(
          (e.body.kind === 'answer.text' && texts.has(e.body.item)) ||
          (e.body.kind === 'answer.choice' && choices.has(e.body.item))
        ),
    );
    const replayText = new Map(confirmed);
    const replayChoice = new Map(confirmedChoice);
    for (const e of queue) applyTo(replayText, replayChoice, e.body);
    for (const item of texts) {
      const text = replayText.get(item) ?? '';
      current.set(item, text);
      on.revert(item, { text });
    }
    for (const item of choices) {
      const choice = replayChoice.get(item) ?? null;
      currentChoice.set(item, choice);
      on.revert(item, { choice });
    }
  };

  const buildBatch = (): Entry[] => {
    const out: Entry[] = [];
    let bytes = envelope;
    let next = acked + 1;
    for (const e of queue) {
      if (out.length >= OUTBOX.maxEvents) break;
      // Offline, only the batch that may have arrived is retried, so it never grows (and the rest can be compacted).
      if (e.seq === undefined && offline && out.length > 0) break;
      const seq = e.seq ?? next;
      const size = bytesOf(wire(e, seq)) + (out.length > 0 ? 1 : 0);
      if (bytes + size > OUTBOX.maxBodyBytes && out.length > 0) break;
      e.seq = seq;
      out.push(e);
      next = seq + 1;
      bytes += size;
    }
    return out;
  };

  /** The edge refused the whole batch (400/413): nothing of it was stored. */
  const reject = (batch: Entry[]) => {
    const sent = new Set(batch);
    const texts = new Set<number>();
    const choices = new Set<number>();
    for (const e of batch) {
      if (e.body.kind === 'answer.text') texts.add(e.body.item);
      if (e.body.kind === 'answer.choice') choices.add(e.body.item);
    }
    const hadAnswer = texts.size + choices.size > 0;
    const again = hadAnswer ? batch.filter((e) => keptAlways(e.body)) : [];
    queue = [
      ...again,
      ...queue.filter(
        (e) =>
          !sent.has(e) &&
          !(e.body.kind === 'answer.text' && texts.has(e.body.item)) &&
          !(e.body.kind === 'answer.choice' && choices.has(e.body.item)),
      ),
    ];
    for (const e of queue) delete e.seq;
    for (const item of texts) {
      const text = confirmed.get(item) ?? '';
      current.set(item, text);
      on.revert(item, { text });
    }
    for (const item of choices) {
      const choice = confirmedChoice.get(item) ?? null;
      currentChoice.set(item, choice);
      on.revert(item, { choice });
    }
  };

  /** Unsent events older than 10 minutes give way to one edit per item from what the edge may hold to now. */
  const compact = () => {
    if (stopped || inFlight) return;
    const first = queue.findIndex((e) => e.seq === undefined);
    const oldest = first < 0 ? undefined : queue[first];
    if (oldest === undefined || mono() - oldest.at <= OUTBOX.keepUnsentMs) return;
    const kept = queue.slice(0, first);
    // SR-4: every unsent signal stays (evidence is never compacted away); heartbeats and the answer edits go, the
    // edits replaced below by one edit per item.
    const signals = queue.slice(first).filter((e) => keptAlways(e.body));
    const baseText = new Map(confirmed);
    const baseChoice = new Map(confirmedChoice);
    for (const e of kept) applyTo(baseText, baseChoice, e.body);
    queue = [...kept, ...signals];
    for (const [item, text] of current) {
      const base = baseText.get(item) ?? '';
      if (text !== base) enqueueText(item, base, text);
    }
    for (const [item, choice] of currentChoice) {
      if (choice !== (baseChoice.get(item) ?? null))
        enqueue({ kind: 'answer.choice', item, option: choice });
    }
  };

  const goOffline = () => {
    failures += 1;
    const wait = OUTBOX.backoffMs[Math.min(failures, OUTBOX.backoffMs.length) - 1] ?? 10_000;
    notBefore = mono() + wait;
    if (!offline) {
      offline = true;
      on.status('offline');
    }
    settleWaiters(false);
    later(wait);
  };

  const pump = async (): Promise<void> => {
    if (stopped || inFlight || queue.length === 0) return;
    const now = mono();
    if (now < notBefore) return later(notBefore - now);
    if (now - lastSentAt < OUTBOX.minGapMs) return later(OUTBOX.minGapMs - (now - lastSentAt));
    const batch = buildBatch();
    if (batch.length === 0) return;
    inFlight = true;
    lastSentAt = now;
    const sentAt = wall();
    const res = await deps.api.events(deps.sessionToken, {
      streamId: deps.streamId,
      events: batch.map((e) => wire(e, e.seq ?? 0)),
    });
    inFlight = false;
    if (stopped) return;
    if (res.ok) {
      const receivedAt = wall();
      failures = 0;
      notBefore = -Infinity;
      if (offline) {
        offline = false;
        on.status('online');
      }
      ackTo(res.value.ackSeq, new Set(res.value.refusedSeqs ?? []));
      const serverNowMs = Date.parse(res.value.serverNow);
      on.ack({
        ackSeq: res.value.ackSeq,
        serverNowMs,
        deadlineAtMs: Date.parse(res.value.deadlineAt),
        offsetMs: Math.round(serverNowMs - (sentAt + receivedAt) / 2),
        state: res.value.state,
      });
      settleWaiters(null);
      // A backlog (a split batch, or events waiting longer than one interval) goes out without waiting for the tick.
      if (waiters.length > 0 || queue.some((e) => mono() - e.at >= OUTBOX.batchEveryMs)) {
        later(OUTBOX.minGapMs);
      }
      return;
    }
    const failure = res;
    const ended = ENDS[failure.code];
    if (ended !== undefined) return end(ended);
    if (failure.code === 'out_of_order') {
      // The edge holds everything up to ackSeq; the rest is resent with the same numbers.
      ackTo(failure.ackSeq ?? acked);
      settleWaiters(null);
      return later(OUTBOX.minGapMs);
    }
    if (
      failure.code === 'bad_request' ||
      failure.code === 'too_large' ||
      failure.code === 'bad_media'
    ) {
      reject(batch);
      settleWaiters(null);
      return;
    }
    if (failure.status === 429) {
      notBefore = mono() + (failure.retryAfterSeconds ?? 1) * 1_000;
      return later(notBefore - mono());
    }
    if (isOffline(failure)) return goOffline();
    // Any other answer: treat like a failed attempt (it may be transient) without dropping anything.
    return goOffline();
  };

  const tick = setInterval(() => {
    compact();
    void pump();
  }, OUTBOX.batchEveryMs);
  const beat = setInterval(() => enqueue({ kind: 'heartbeat' }), deps.heartbeatSeconds * 1_000);

  return {
    text(item, next, maxChars) {
      if (stopped) return false;
      const prev = current.get(item) ?? '';
      if (next === prev) return true;
      if (next.length > maxChars || !isStorableText(next)) return false;
      enqueueText(item, prev, next);
      current.set(item, next);
      return true;
    },
    choice(item, option) {
      if (stopped || (currentChoice.get(item) ?? null) === option) return;
      enqueue({ kind: 'answer.choice', item, option });
      currentChoice.set(item, option);
    },
    signal(signal) {
      enqueue({ kind: 'signal', ...signal } as Body);
    },
    finish(sectionId) {
      enqueue({ kind: 'section.finish', sectionId });
    },
    flush() {
      if (stopped) return Promise.resolve(false);
      if (queue.length === 0) return Promise.resolve(true);
      const promise = new Promise<boolean>((resolve) => {
        waiters.push({ until: mono(), resolve });
      });
      if (!inFlight) {
        if (mono() < notBefore) {
          // Offline: say so now; the retry timer keeps trying.
          settleWaiters(false);
        } else void pump();
      }
      return promise;
    },
    ackedSeq: () => acked,
    // Queued events are numbered (or will be) acked + 1, acked + 2, … in order, so the last one gets this seq.
    enqueuedSeq: () => acked + queue.length,
    pending: () => queue.length,
    oldestUnsentAgeMs() {
      const first = queue.find((e) => e.seq === undefined);
      return first === undefined ? 0 : mono() - first.at;
    },
    stop,
  };
};
