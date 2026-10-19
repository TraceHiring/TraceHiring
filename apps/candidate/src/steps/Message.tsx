// Steps that only show a message: resolving, unavailable, blocked (neutral copy, rule 9) and error.
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

const ERRORS: Record<ErrorWhy, string> = {
  superseded: COPY.error.superseded,
  invalid: COPY.error.invalid,
  network: COPY.error.network,
  step: COPY.error.step,
  generic: COPY.error.generic,
};

export function ErrorStep({ why, onRetry }: { why: ErrorWhy; onRetry: (() => void) | null }) {
  return (
    <section>
      <StepHeading>{COPY.error.title}</StepHeading>
      <div role="alert">
        <p className={ui.text}>{ERRORS[why]}</p>
      </div>
      {onRetry === null ? null : (
        <div className={ui.actions}>
          <button type="button" className={ui.button} onClick={onRetry}>
            {COPY.error.retry}
          </button>
        </div>
      )}
    </section>
  );
}
