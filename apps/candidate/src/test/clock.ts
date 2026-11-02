// Time on the test screen (specs/d1-demo-slice.md §4.7): the remaining time is `deadlineAt − (Date.now() + offset)`,
// where `offset = serverNow − midpoint(send, receive)` comes from the edge; nothing the client computes is ever sent
// as a time. `useNow` is a shared ticking clock read through useSyncExternalStore, so render stays pure.
import { useSyncExternalStore } from 'react';
import { COPY } from '../copy';

const TICK_MS = 250;
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  now = Date.now();
  if (timer === undefined) {
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
};
const snapshot = () => now;

/** Date.now(), refreshed four times a second while a component listens. */
export const useNow = (): number => useSyncExternalStore(subscribe, snapshot, snapshot);

export const remainingMs = (deadlineAtMs: number, offsetMs: number, nowMs: number): number =>
  Math.max(0, deadlineAtMs - (nowMs + offsetMs));

const pad = (n: number) => String(n).padStart(2, '0');

/** `mm:ss`, or `h:mm:ss` from an hour; rounded up so 0:00 means the time is up. */
export const formatRemaining = (ms: number): string => {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

/**
 * What the polite live region says: it changes only when 10, 5 and 1 minutes and 30 seconds are left, so a screen
 * reader announces exactly those four moments (§4.7).
 */
export const announcementFor = (ms: number): string => {
  if (ms <= 0) return '';
  if (ms <= 30_000) return COPY.test.announce.thirtySeconds;
  if (ms <= 60_000) return COPY.test.announce.oneMinute;
  if (ms <= 5 * 60_000) return COPY.test.announce.fiveMinutes;
  if (ms <= 10 * 60_000) return COPY.test.announce.tenMinutes;
  return '';
};
