// The item approval form (specs/m1-test-authoring.md M1-3, §4.1, R5-22, R5-40): "Approve" or "Send back" for one
// version in review. It concerns the item only, never a candidate. Self-approval is allowed and logged.
import type { BankItemDetail } from '@trace/shared/contracts/m1';
import ui from '../common/Ui.module.css';
import { bankErrorText } from './labels';

export function ReviewPanel({
  detail,
  userId,
  busy,
  error,
  onDecide,
}: {
  detail: BankItemDetail;
  userId: string;
  busy: boolean;
  error: string | null;
  onDecide(decision: 'approve' | 'not_approved'): void;
}) {
  return (
    <section className={ui.panel} aria-label="Approve this item">
      <h3 className={ui.subtitle}>Approve this item</h3>
      <p className={ui.note}>
        Approving makes this version available to tests. Sending it back ends this version; its
        author can start a new one.
      </p>
      {detail.createdBy === userId && (
        <p className={ui.note}>You wrote this item; self-approval is logged.</p>
      )}
      {error !== null && (
        <p role="alert" className={ui.alert}>
          {bankErrorText(error)}
        </p>
      )}
      <div className={ui.row}>
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={busy}
          onClick={() => {
            onDecide('approve');
          }}
        >
          Approve
        </button>
        <button
          type="button"
          className={ui.button}
          disabled={busy}
          onClick={() => {
            onDecide('not_approved');
          }}
        >
          Send back
        </button>
      </div>
    </section>
  );
}
