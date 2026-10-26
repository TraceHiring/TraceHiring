// The section transition (specs/m1-test-authoring.md R5-66 b; §4.6): when the current section closes (its deadline
// passed on the server-offset clock, the candidate confirmed `section.finish`, or an item GET answered 410
// `section_closed`), the screen flushes the outbox, stops that stream, calls `attach` for a fresh view (new section
// states and deadlines) and continues on the new stream. The edge pushes no transition, so this is the only way the
// screen learns that the next section opened.
//   - The flush is retried while offline (the closing section is already read-only); the old stream is stopped only
//     once everything queued before is acknowledged, because `attach` supersedes it (its next POST would be 401).
//     After three rounds the flush stops waiting for what is still being raised (heartbeats, signals), but never drops
//     a signal (R5-68 b, SR-4): the outbox hands its unsent signals and `section.finish` over, each with the moment it
//     was raised, and the screen sends them first on the new stream.
//   - Only an attach that fails for the network, a 503 or a 429 is retried (1, 2, 4, 8, then every 10 s; Retry-After
//     wins). Any other answer goes once to the screen D1 shows for it (R5-68 g): `superseded` to "open in another
//     window", an answer that fits no contract to the network error, every other code to "can no longer be used here"
//     (D1 forgets a stored session the edge refuses and sends the candidate back to the link). A finished session
//     shows its receipt.
//   - It never runs twice at once, and never after the test began submitting (a submit on the old stream would
//     race the attach).
import type { Receipt } from '@trace/shared/contracts/candidate';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { AnyView, CandidateApi } from '../api';
import { offsetOf } from '../flow';
import { saveSession } from '../session-store';
import type { Held, Outbox } from './outbox';

export const TRANSITION = {
  flushRetryMs: 2_000,
  attachBackoffMs: [1_000, 2_000, 4_000, 8_000, 10_000],
} as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface TransitionDeps {
  api: Pick<CandidateApi, 'attach'>;
  sessionToken: string;
  outboxRef: RefObject<Outbox | null>;
  /** False once the screen is gone, the receipt shown, the test submitting or the stream ended. */
  mayRun: () => boolean;
  /** A new view on a new stream, with the server-clock offset measured on this attach. */
  apply(view: AnyView, offsetMs: number): void;
  /** Events the stopped stream handed over, to send first on the next one (R5-68 b). */
  hold(events: Held[]): void;
  receipt(receipt: Receipt): void;
  end(why: 'superseded' | 'invalid' | 'network'): void;
}

export const useSectionTransition = (deps: TransitionDeps) => {
  const depsRef = useRef(deps);
  useLayoutEffect(() => {
    depsRef.current = deps;
  });
  const running = useRef(false);
  const [moving, setMoving] = useState(false);

  /** Flushes until the queue is empty (retrying while offline); false if the screen should stop. */
  const flushAll = async (): Promise<boolean> => {
    for (let round = 0; ; round += 1) {
      const d = depsRef.current;
      const outbox = d.outboxRef.current;
      if (!d.mayRun()) return false;
      if (outbox === null) return true; // already stopped by an earlier attempt
      const flushed = await outbox.flush();
      if (!depsRef.current.mayRun()) return false;
      if (flushed && (outbox.pending() === 0 || round >= 2)) return true;
      if (!flushed) await sleep(TRANSITION.flushRetryMs);
    }
  };

  const attachLoop = async (): Promise<void> => {
    for (let failures = 0; ; failures += 1) {
      const d = depsRef.current;
      if (!d.mayRun()) return;
      const sentAt = Date.now();
      const res = await d.api.attach(d.sessionToken);
      const receivedAt = Date.now();
      const now = depsRef.current;
      if (!now.mayRun()) return;
      if (res.ok) {
        const { view } = res.value;
        saveSession({ sessionToken: now.sessionToken, streamId: view.streamId, view });
        if (view.receipt !== undefined) return now.receipt(view.receipt);
        return now.apply(view, offsetOf(view.serverNow, sentAt, receivedAt));
      }
      if (res.code === 'superseded') return now.end('superseded');
      const retried = res.code === 'network' || res.status === 503 || res.status === 429;
      if (!retried) return now.end(res.code === 'unexpected' ? 'network' : 'invalid');
      const backoff = TRANSITION.attachBackoffMs;
      const wait =
        res.retryAfterSeconds !== undefined
          ? res.retryAfterSeconds * 1_000
          : (backoff[Math.min(failures, backoff.length - 1)] ?? 10_000);
      await sleep(wait);
    }
  };

  const transition = async (): Promise<void> => {
    if (running.current || !depsRef.current.mayRun()) return;
    running.current = true;
    setMoving(true);
    try {
      if (!(await flushAll())) return;
      const d = depsRef.current;
      const outbox = d.outboxRef.current;
      // From now on a raised signal waits for the next stream; the old one hands over what it did not deliver.
      d.outboxRef.current = null;
      if (outbox !== null) depsRef.current.hold(await outbox.handOver());
      await attachLoop();
    } finally {
      running.current = false;
      setMoving(false);
    }
  };

  return { moving, transition, isMoving: () => running.current };
};
