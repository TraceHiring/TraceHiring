// "Previous page" / "Next page" for a keyset-paged list (R5-31). `of` names the list when a screen has several
// ("Next page of slots"), so each button has its own name.
import ui from '../common/Ui.module.css';

export function PagerControls({
  hasPrevious,
  hasNext,
  of,
  onPrevious,
  onNext,
}: {
  hasPrevious: boolean;
  hasNext: boolean;
  of?: string;
  onPrevious(): void;
  onNext(): void;
}) {
  if (!hasPrevious && !hasNext) return null;
  const suffix = of === undefined ? '' : ` of ${of}`;
  return (
    <div className={ui.row}>
      {hasPrevious && (
        <button type="button" className={ui.button} onClick={onPrevious}>
          {`Previous page${suffix}`}
        </button>
      )}
      {hasNext && (
        <button type="button" className={ui.button} onClick={onNext}>
          {`Next page${suffix}`}
        </button>
      )}
    </div>
  );
}
