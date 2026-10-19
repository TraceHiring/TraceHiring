// A small external store that loads one resource and, while the answer is not final, polls it again
// (specs/d1-demo-slice.md §6.1: every 3 s; after 90 s every 15 s with "Taking longer than usual"; there is no
// failed state, so an unreadable or failed answer is "unavailable" and the polling goes on). One poller serves one
// endpoint: a card never reads another card's poller (rule 1).
import { useSyncExternalStore } from 'react';
import type { ApiResult } from '../api/client';

export const FAST_MS = 3000;
export const SLOW_AFTER_MS = 90_000;
export const SLOW_MS = 15_000;

export type PollState<T> =
  { kind: 'loading' } | { kind: 'value'; value: T } | { kind: 'unavailable' };

export interface PollSnapshot<T> {
  readonly state: PollState<T>;
  /** True once the card has stayed non-final for 90 s. */
  readonly slow: boolean;
}

export interface PollerOptions<T> {
  fetchCard(): Promise<ApiResult<T>>;
  /** True when no further poll is needed (the card is ready, or it is final for good). */
  isFinal(value: T): boolean;
}

export class CardPoller<T> {
  private readonly options: PollerOptions<T>;
  private readonly listeners = new Set<() => void>();
  private snapshot: PollSnapshot<T> = { state: { kind: 'loading' }, slow: false };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  /** Bumped by start and stop: an answer from an older run is dropped. */
  private epoch = 0;
  private running = false;

  constructor(options: PollerOptions<T>) {
    this.options = options;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): PollSnapshot<T> => this.snapshot;

  private set(snapshot: PollSnapshot<T>): void {
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) listener();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();
    const epoch = ++this.epoch;
    void this.poll(epoch);
  }

  stop(): void {
    this.running = false;
    this.epoch += 1;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async poll(epoch: number): Promise<void> {
    let result: ApiResult<T>;
    try {
      result = await this.options.fetchCard();
    } catch {
      result = { ok: false, code: 'network' };
    }
    if (epoch !== this.epoch) return;
    const elapsed = Date.now() - this.startedAt;
    if (result.ok) {
      const final = this.options.isFinal(result.data);
      this.set({
        state: { kind: 'value', value: result.data },
        slow: !final && elapsed >= SLOW_AFTER_MS,
      });
      if (final) {
        this.running = false;
        return;
      }
    } else {
      // Keep the last good value on screen; otherwise the card is "unavailable" (never a failed band or score).
      const previous = this.snapshot.state;
      this.set({
        state: previous.kind === 'value' ? previous : { kind: 'unavailable' },
        slow: elapsed >= SLOW_AFTER_MS,
      });
    }
    const delay = elapsed >= SLOW_AFTER_MS ? SLOW_MS : FAST_MS;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll(epoch);
    }, delay);
  }
}

/** Subscribes a component to a poller. */
export function usePoller<T>(poller: CardPoller<T>): PollSnapshot<T> {
  return useSyncExternalStore(poller.subscribe, poller.getSnapshot, poller.getSnapshot);
}
