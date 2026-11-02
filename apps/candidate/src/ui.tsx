// Shared building blocks for the steps (specs/d1-demo-slice.md §4.7 accessibility minimum): one h1 per step that
// takes focus when the step appears, a `role="alert"` error summary, and a polite status region.
import { useEffect, useRef, type ReactNode } from 'react';
import { COPY } from './copy';
import styles from './ui.module.css';

/** The step's single h1; focus moves to it when the step mounts, so a screen reader starts here. */
export function StepHeading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} className={styles.heading}>
      {children}
    </h1>
  );
}

/** An error summary, announced at once. Renders nothing without a message. */
export function ErrorSummary({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <div role="alert" className={styles.error}>
      <p className={styles.errorTitle}>{COPY.errorSummaryTitle}</p>
      <p className={styles.errorBody}>{message}</p>
    </div>
  );
}

/** A polite live region for status lines (saving, offline, uploading). Always rendered, so changes are announced. */
export function Status({ message }: { message: string }) {
  return (
    <p className={styles.status} aria-live="polite" role="status">
      {message}
    </p>
  );
}

export { styles as ui };
