// A multiple-choice answer (specs/d1-demo-slice.md §4.4): one radio group; each change is one `answer.choice` event,
// and "Clear my choice" sends `option: null`.
import { COPY } from '../copy';
import { ui } from '../ui';
import styles from './Test.module.css';

interface Props {
  position: number;
  options: { id: string; label: string }[];
  choice: string | null;
  disabled: boolean;
  onChoose(option: string | null): void;
}

export function McqItem({ position, options, choice, disabled, onChoose }: Props) {
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={ui.label}>{COPY.test.chooseOne}</legend>
      {options.map((option) => (
        <label key={option.id} className={styles.option}>
          <input
            type="radio"
            name={`item-${position}`}
            value={option.id}
            checked={choice === option.id}
            onChange={() => onChoose(option.id)}
          />
          <span>{option.label}</span>
        </label>
      ))}
      <div className={ui.actions}>
        <button
          type="button"
          className={ui.secondary}
          onClick={() => onChoose(null)}
          disabled={disabled || choice === null}
        >
          {COPY.test.clearChoice}
        </button>
      </div>
    </fieldset>
  );
}
