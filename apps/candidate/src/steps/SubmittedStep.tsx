// Step 8 (D1-11, rule 5): the receipt only, `TR-XXXXXXXX` and the time it was submitted. Never a score or a band.
import type { Receipt } from '@trace/shared/contracts/candidate';
import { COPY, receiptLabel } from '../copy';
import { StepHeading, ui } from '../ui';

const formatTime = (iso: string): string => {
  try {
    return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
};

export function SubmittedStep({ receipt }: { receipt: Receipt }) {
  return (
    <section>
      <StepHeading>{COPY.submitted.title}</StepHeading>
      <p className={ui.text}>{COPY.submitted.body}</p>
      <dl>
        <dt className={ui.label}>{COPY.submitted.receiptLabel}</dt>
        <dd className={ui.receipt} data-testid="receipt-ref">
          {receiptLabel(receipt.receiptRef)}
        </dd>
        <dt className={ui.label}>{COPY.submitted.submittedAtLabel}</dt>
        <dd className={ui.text}>
          <time dateTime={receipt.submittedAt}>{formatTime(receipt.submittedAt)}</time>
        </dd>
      </dl>
      <p className={ui.muted}>{COPY.submitted.keep}</p>
    </section>
  );
}
