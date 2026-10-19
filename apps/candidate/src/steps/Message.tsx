// Steps that only show a message: resolving, unavailable, blocked (neutral copy, rule 9) and error.
import { useEffect, useState } from 'react';
import { COPY } from '../copy';
import type { ErrorWhy, UnavailableWhy } from '../flow';
import { StepHeading, ui } from '../ui';

export function ResolvingStep() {
  return (
    <section aria-busy="true">
      <StepHeading>{COPY.resolving.title}</StepHeading>
      <p className={ui.text}>{COPY.resolving.body}</p>
    </section>
  );
}

const UNAVAILABLE: Record<UnavailableWhy, string> = {
  no_link: COPY.unavailable.noLink,
  invalid: COPY.unavailable.invalid,
  expired: COPY.unavailable.expired,
  revoked: COPY.unavailable.revoked,
  submitted: COPY.unavailable.submitted,
  closed: COPY.unavailable.closed,
  config: COPY.unavailable.config,
};

export function UnavailableStep({ why }: { why: UnavailableWhy }) {
  return (
    <section>
      <StepHeading>{COPY.unavailable.title}</StepHeading>
      <p className={ui.text}>{UNAVAILABLE[why]}</p>
    </section>
  );
}

/** Under 18 (rule 9): a neutral message, no consent, no camera, nothing else to do. */
export function BlockedStep() {
  return (
    <section>
      <StepHeading>{COPY.blocked.title}</StepHeading>
      <p className={ui.text}>{COPY.blocked.body}</p>
    </section>
  );
}

const ERRORS: Record<Exclude<ErrorWhy, 'rate_limited'>, string> = {
  superseded: COPY.error.superseded,
  invalid: COPY.error.invalid,
  network: COPY.error.network,
  step: COPY.error.step,
  generic: COPY.error.generic,
};

/**
 * An error, with "Try again" when the step can be retried. With `waitSeconds` (a 429 from the edge), the wait copy is
 * shown and "Try again" stays disabled until that wait has passed; nothing is retried on its own.
 */
export function ErrorStep({
  why,
  onRetry,
  waitSeconds,
}: {
  why: ErrorWhy;
  onRetry: (() => void) | null;
  waitSeconds?: number | undefined;
}) {
  // Each refusal mounts a new ErrorStep (the step passes through `resolving`), so the initial state starts the wait.
  const [waiting, setWaiting] = useState(waitSeconds !== undefined);
  useEffect(() => {
    if (waitSeconds === undefined) return;
    const timer = setTimeout(() => setWaiting(false), waitSeconds * 1000);
    return () => clearTimeout(timer);
  }, [waitSeconds]);
  const message = why === 'rate_limited' ? COPY.rules.wait(waitSeconds) : ERRORS[why];
  return (
    <section>
      <StepHeading>{COPY.error.title}</StepHeading>
      <div role="alert">
        <p className={ui.text}>{message}</p>
      </div>
      {onRetry === null ? null : (
        <div className={ui.actions}>
          <button type="button" className={ui.button} onClick={onRetry} disabled={waiting}>
            {COPY.error.retry}
          </button>
        </div>
      )}
    </section>
  );
}
