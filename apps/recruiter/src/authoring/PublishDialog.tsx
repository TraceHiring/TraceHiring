// The publish dialog (specs/d1-demo-slice.md §6.1, Q20; specs/m1-test-authoring.md §6.10, R5-69 h): the freeze copy
// with "Publish test" and "Cancel" only. Shared by D1's editor and the v2 wizard; TestEditorPage re-exports it.
import ui from '../common/Ui.module.css';

export const FREEZE_COPY =
  'Settings freeze when you publish, including the cutoff; later changes create a new version';

export function PublishDialog({
  busy,
  onPublish,
  onCancel,
}: {
  busy: boolean;
  onPublish(): void;
  onCancel(): void;
}) {
  return (
    <div className={ui.dialog} role="dialog" aria-labelledby="publish-title" aria-modal="false">
      <h3 id="publish-title" className={ui.subtitle}>
        Publish this test
      </h3>
      <p>{FREEZE_COPY}</p>
      <div className={ui.row}>
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={busy}
          onClick={onPublish}
        >
          Publish test
        </button>
        <button type="button" className={ui.button} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
