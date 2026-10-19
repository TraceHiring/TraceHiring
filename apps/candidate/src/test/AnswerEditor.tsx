// A written answer (specs/d1-demo-slice.md §4.4): a labelled textarea whose every change becomes one `answer.text`
// splice. `maxLength` matches the edge's `maxChars` (UTF-16 units); an edit the outbox refuses (unstorable text, over
// the limit) is not applied, so the textarea keeps the last good text. Spell check is off (SEC-7): answer text is
// never offered to a browser vendor's server-side spelling service.
import { useId } from 'react';
import { COPY } from '../copy';
import { ui } from '../ui';
import styles from './Test.module.css';

interface Props {
  value: string;
  maxChars: number;
  disabled: boolean;
  onChange(next: string): void;
}

export function AnswerEditor({ value, maxChars, disabled, onChange }: Props) {
  const id = useId();
  const countId = useId();
  return (
    <div className={ui.field}>
      <label htmlFor={id} className={ui.label}>
        {COPY.test.answerLabel}
      </label>
      <textarea
        id={id}
        className={styles.textarea}
        value={value}
        maxLength={maxChars}
        rows={10}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        aria-describedby={countId}
        onChange={(e) => onChange(e.target.value)}
      />
      <span id={countId} className={ui.muted}>
        {COPY.test.chars(value.length, maxChars)}
      </span>
    </div>
  );
}
