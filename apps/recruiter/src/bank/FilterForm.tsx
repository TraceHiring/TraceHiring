// The filter form of the bank list and the library browser. Controlled; the parent applies it on submit.
import { ITEM_ORIGINS, ITEM_STATUSES, type ItemFormat } from '@trace/shared/contracts/m1';
import type { FormEvent } from 'react';
import ui from '../common/Ui.module.css';
import type { Filters } from './filters';
import { FORMAT_LABEL, ORIGIN_LABEL, SKILL_SUGGESTIONS, STATUS_LABEL } from './labels';

const FORMATS: readonly ItemFormat[] = ['mcq', 'written'];

export function FilterForm({
  kind,
  value,
  error,
  onChange,
  onApply,
  onReset,
}: {
  kind: 'bank' | 'library';
  value: Filters;
  error: string | null;
  onChange(next: Filters): void;
  onApply(): void;
  onReset(): void;
}) {
  const set = <K extends keyof Filters>(key: K, next: Filters[K]) => {
    onChange({ ...value, [key]: next });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onApply();
  };
  const listId = `${kind}-skill-suggestions`;
  return (
    <form className={ui.form} onSubmit={submit} aria-label="Filters">
      <label className={ui.field}>
        <span className={ui.label}>Format</span>
        <select
          className={ui.select}
          value={value.format}
          onChange={(e) => {
            set('format', e.target.value === '' ? '' : (e.target.value as ItemFormat));
          }}
        >
          <option value="">Any format</option>
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABEL[f]}
            </option>
          ))}
        </select>
      </label>
      <label className={ui.field}>
        <span className={ui.label}>Skill</span>
        <input
          className={ui.input}
          type="text"
          list={listId}
          value={value.skillKey}
          onChange={(e) => {
            set('skillKey', e.target.value);
          }}
        />
        <datalist id={listId}>
          {SKILL_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
      <label className={ui.field}>
        <span className={ui.label}>Difficulty from</span>
        <input
          className={ui.input}
          type="text"
          inputMode="decimal"
          placeholder="0 to 1"
          value={value.difficultyMin}
          onChange={(e) => {
            set('difficultyMin', e.target.value);
          }}
        />
      </label>
      <label className={ui.field}>
        <span className={ui.label}>Difficulty to</span>
        <input
          className={ui.input}
          type="text"
          inputMode="decimal"
          placeholder="0 to 1"
          value={value.difficultyMax}
          onChange={(e) => {
            set('difficultyMax', e.target.value);
          }}
        />
      </label>
      {kind === 'bank' && (
        <>
          <label className={ui.field}>
            <span className={ui.label}>Status</span>
            <select
              className={ui.select}
              value={value.status}
              onChange={(e) => {
                set('status', e.target.value as Filters['status']);
              }}
            >
              <option value="">Any status</option>
              {ITEM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className={ui.field}>
            <span className={ui.label}>Origin</span>
            <select
              className={ui.select}
              value={value.origin}
              onChange={(e) => {
                set('origin', e.target.value as Filters['origin']);
              }}
            >
              <option value="">Any origin</option>
              {ITEM_ORIGINS.map((o) => (
                <option key={o} value={o}>
                  {ORIGIN_LABEL[o]}
                </option>
              ))}
            </select>
          </label>
          <label className={ui.field}>
            <span className={ui.label}>Pool id</span>
            <input
              className={ui.input}
              type="text"
              value={value.poolId}
              onChange={(e) => {
                set('poolId', e.target.value);
              }}
            />
          </label>
        </>
      )}
      {error !== null && (
        <p role="alert" className={ui.alert}>
          {error}
        </p>
      )}
      <div className={ui.row}>
        <button type="submit" className={`${ui.button} ${ui.primary}`}>
          Apply filters
        </button>
        <button type="button" className={ui.button} onClick={onReset}>
          Reset filters
        </button>
      </div>
    </form>
  );
}
