// One question on the test screen (specs/d1-demo-slice.md §4.4; M1 R5-9, R5-10): the prompt, its images (v2), and
// the answer control. Options render exactly in the served order (the DO already shuffled them; never re-sorted
// here). `editable` false locks the control (submitting, a closed section, a passed forward-only question).
import type { AnyItem, CandidateApi } from '../api';
import { COPY } from '../copy';
import { ErrorSummary, ui } from '../ui';
import { AnswerEditor } from './AnswerEditor';
import { ItemImages } from './ItemImages';
import { McqItem } from './McqItem';
import styles from './Test.module.css';

/** The edge's limit for a written item without its own `maxChars` (§4.4). */
export const DEFAULT_MAX_CHARS = 10_000;

/** What to show when the item is not loaded: loading, a failure with a retry, or a neutral line (no request). */
export type Missing = 'loading' | 'failed' | 'passed' | 'unavailable';

interface Props {
  api: Pick<CandidateApi, 'media'>;
  sessionToken: string;
  item: AnyItem | undefined;
  missing: Missing;
  editable: boolean;
  text: string;
  choice: string | null;
  onText(next: string): void;
  onChoose(option: string | null): void;
  onRetry(): void;
}

export function ItemPane(props: Props) {
  const { item, missing, editable } = props;
  if (item === undefined) {
    if (missing === 'failed') {
      return (
        <>
          <ErrorSummary message={COPY.test.itemFailed} />
          <button type="button" className={ui.secondary} onClick={props.onRetry}>
            {COPY.test.retry}
          </button>
        </>
      );
    }
    if (missing === 'passed') return <p className={ui.text}>{COPY.test.passedQuestion}</p>;
    if (missing === 'unavailable') return null;
    return <p className={ui.text}>{COPY.test.loadingItem}</p>;
  }
  const media = 'media' in item ? item.media : undefined;
  return (
    <>
      <p className={styles.prompt}>{item.prompt}</p>
      {media === undefined ? null : (
        <ItemImages api={props.api} sessionToken={props.sessionToken} media={media} />
      )}
      {item.kind === 'mcq' ? (
        <McqItem
          position={item.position}
          options={item.options ?? []}
          choice={props.choice}
          disabled={!editable}
          onChoose={props.onChoose}
        />
      ) : (
        <AnswerEditor
          value={props.text}
          maxChars={item.maxChars ?? DEFAULT_MAX_CHARS}
          disabled={!editable}
          onChange={props.onText}
        />
      )}
    </>
  );
}
