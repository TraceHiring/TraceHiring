// The start photo panel (specs/d1-demo-slice.md §6.1). "View start photo" asks for a new single-use link on every
// click; the bytes are drawn with the viewer's watermark and shown as a data URL. "Viewing is logged."
import { usePhoto, type PhotoState, type StartPhotoController } from './start-photo';
import styles from './Report.module.css';

const ERROR_TEXT = {
  aal2: 'Two-step sign-in is needed to view the start photo.',
  generic: 'The start photo could not be shown. Try again.',
} as const;

export function StartPhotoView({
  photoMissing,
  state,
  onView,
}: {
  photoMissing: boolean;
  state: PhotoState;
  onView: () => void;
}) {
  return (
    <section className={styles.panel} aria-labelledby="start-photo-title">
      <h3 id="start-photo-title">Start photo</h3>
      {photoMissing ? (
        <p>No start photo</p>
      ) : (
        <div className={styles.photo}>
          {state.kind === 'shown' && (
            <img
              className={styles.photoImage}
              src={state.dataUrl}
              alt="Candidate at the start of the test, with a viewing watermark"
            />
          )}
          {state.kind === 'error' && (
            <p role="alert" className={styles.alert}>
              {ERROR_TEXT[state.reason]}
            </p>
          )}
          <button
            type="button"
            className={styles.button}
            disabled={state.kind === 'working'}
            onClick={onView}
          >
            {state.kind === 'shown' ? 'View start photo again' : 'View start photo'}
          </button>
          <p className={styles.note}>Viewing is logged.</p>
        </div>
      )}
    </section>
  );
}

export function StartPhotoPanel({
  controller,
  photoMissing,
}: {
  controller: StartPhotoController;
  photoMissing: boolean;
}) {
  const state = usePhoto(controller);
  return (
    <StartPhotoView
      photoMissing={photoMissing}
      state={state}
      onView={() => {
        void controller.view();
      }}
    />
  );
}
