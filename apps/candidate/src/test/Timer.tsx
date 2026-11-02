// The test timer (specs/d1-demo-slice.md §4.7): the server's deadline read through the server clock offset. The
// visible clock is not a live region; a separate polite region speaks only at 10, 5 and 1 minutes and 30 seconds.
// At zero it calls `onExpire` once (the screen then flushes and submits; the alarm is the backstop).
import { useEffect, useEffectEvent } from 'react';
import { COPY } from '../copy';
import { ui } from '../ui';
import { announcementFor, formatRemaining, remainingMs, useNow } from './clock';
import styles from './Test.module.css';

interface Props {
  deadlineAtMs: number;
  offsetMs: number;
  onExpire(): void;
}

export function Timer({ deadlineAtMs, offsetMs, onExpire }: Props) {
  const now = useNow();
  const left = remainingMs(deadlineAtMs, offsetMs, now);
  const expired = left <= 0;
  const expire = useEffectEvent(() => onExpire());
  useEffect(() => {
    if (expired) expire();
  }, [expired]);

  return (
    <div className={styles.timer}>
      <span className={styles.timerLabel}>{COPY.test.timeLeft}</span>
      <span role="timer" className={styles.timerValue} data-testid="timer">
        {formatRemaining(left)}
      </span>
      <span className={ui.srOnly} aria-live="polite">
        {announcementFor(left)}
      </span>
    </div>
  );
}
