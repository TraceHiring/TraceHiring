// The item editor's fields (specs/m1-test-authoring.md §6.2, §6.3): MCQ and written items, parameterised quant
// items with a parameter spec, images by stored key with required alt text. Controlled; the parent saves.
import type { ItemFormat } from '@trace/shared/contracts/m1';
import ui from '../common/Ui.module.css';
import {
  MAX_MEDIA,
  MAX_OPTIONS,
  MIN_OPTIONS,
  addMedia,
  addOption,
  errorAt,
  removeOption,
  type FieldError,
  type ItemForm,
} from './item-form';
import { SKILL_SUGGESTIONS } from './labels';
import { SpecEditor } from './SpecEditor';

function FieldProblem({ errors, path }: { errors: readonly FieldError[]; path: string }) {
  const message = errorAt(errors, path);
  return message === undefined ? null : (
    <span role="alert" className={ui.alert}>
      {message}
    </span>
  );
}

export function ItemFormView({
  form,
  errors,
  formatLocked,
  onChange,
}: {
  form: ItemForm;
  errors: readonly FieldError[];
  /** True when editing a stored item: its format never changes. */
  formatLocked: boolean;
  onChange(next: ItemForm): void;
}) {
  const set = (patch: Partial<ItemForm>) => {
    onChange({ ...form, ...patch });
  };
  const formats: { value: ItemFormat; label: string }[] = [
    { value: 'mcq', label: 'Multiple choice' },
    { value: 'written', label: 'Written' },
  ];
  // Errors of the whole form (a path of ''), such as a key that is not one of the options.
  const general = errors.filter((e) => e.path === '');
  return (
    <div className={ui.stack}>
      <fieldset className={ui.fieldset} disabled={formatLocked}>
        <legend>Format</legend>
        <div className={ui.row}>
          {formats.map((f) => (
            <label key={f.value} className={ui.choice}>
              <input
                type="radio"
                name="format"
                checked={form.format === f.value}
                onChange={() => {
                  set({ format: f.value });
                }}
              />
              <span>{f.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className={ui.field}>
        <span className={ui.label}>Question</span>
        <textarea
          className={ui.textarea}
          value={form.stem}
          onChange={(e) => {
            set({ stem: e.target.value });
          }}
        />
        <FieldProblem errors={errors} path="stem" />
      </label>

      {form.format === 'mcq' ? (
        <fieldset className={ui.fieldset}>
          <legend>Options</legend>
          {form.options.map((o, i) => {
            const n = String(i + 1);
            return (
              <div key={o.id} className={ui.row}>
                <label className={ui.choice}>
                  <input
                    type="radio"
                    name="key"
                    aria-label={`Correct answer: option ${n}`}
                    checked={form.keyOptionId === o.id}
                    onChange={() => {
                      set({ keyOptionId: o.id });
                    }}
                  />
                  <span>Correct</span>
                </label>
                <label className={ui.field}>
                  <span className={ui.label}>{`Option ${n}`}</span>
                  <input
                    className={ui.input}
                    type="text"
                    value={o.text}
                    onChange={(e) => {
                      set({
                        options: form.options.map((row) =>
                          row.id === o.id ? { ...row, text: e.target.value } : row,
                        ),
                      });
                    }}
                  />
                  <FieldProblem errors={errors} path={`options.${String(i)}.text`} />
                </label>
                <button
                  type="button"
                  className={ui.button}
                  aria-label={`Remove option ${n}`}
                  disabled={form.options.length <= MIN_OPTIONS}
                  onClick={() => {
                    onChange(removeOption(form, o.id));
                  }}
                >
                  Remove
                </button>
              </div>
            );
          })}
          <FieldProblem errors={errors} path="options" />
          <FieldProblem errors={errors} path="key.optionId" />
          <div>
            <button
              type="button"
              className={ui.button}
              disabled={form.options.length >= MAX_OPTIONS}
              onClick={() => {
                onChange(addOption(form));
              }}
            >
              Add option
            </button>
          </div>
        </fieldset>
      ) : (
        <label className={ui.field}>
          <span className={ui.label}>Rubric version id</span>
          <input
            className={ui.input}
            type="text"
            value={form.rubricVersionId}
            onChange={(e) => {
              set({ rubricVersionId: e.target.value });
            }}
          />
          <FieldProblem errors={errors} path="rubricVersionId" />
        </label>
      )}

      <label className={ui.field}>
        <span className={ui.label}>Skill</span>
        <input
          className={ui.input}
          type="text"
          list="item-skill-suggestions"
          value={form.skillKey}
          onChange={(e) => {
            set({ skillKey: e.target.value });
          }}
        />
        <datalist id="item-skill-suggestions">
          {SKILL_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <FieldProblem errors={errors} path="skillKey" />
      </label>
      <label className={ui.field}>
        <span className={ui.label}>Difficulty</span>
        <input
          className={ui.input}
          type="text"
          inputMode="decimal"
          placeholder="0 to 1"
          value={form.difficulty}
          onChange={(e) => {
            set({ difficulty: e.target.value });
          }}
        />
        <FieldProblem errors={errors} path="difficulty" />
      </label>

      <fieldset className={ui.fieldset}>
        <legend>Images</legend>
        <p className={ui.note}>
          An image is referenced by its stored key, and every image needs alt text.
        </p>
        {form.media.map((m, i) => {
          const n = String(i + 1);
          return (
            <div key={i} className={ui.row}>
              <label className={ui.field}>
                <span className={ui.label}>{`Image key ${n}`}</span>
                <input
                  className={ui.input}
                  type="text"
                  value={m.key}
                  onChange={(e) => {
                    set({
                      media: form.media.map((row, at) =>
                        at === i ? { ...row, key: e.target.value } : row,
                      ),
                    });
                  }}
                />
                <FieldProblem errors={errors} path={`media.${String(i)}.key`} />
              </label>
              <label className={ui.field}>
                <span className={ui.label}>{`Alt text ${n}`}</span>
                <input
                  className={ui.input}
                  type="text"
                  value={m.alt}
                  onChange={(e) => {
                    set({
                      media: form.media.map((row, at) =>
                        at === i ? { ...row, alt: e.target.value } : row,
                      ),
                    });
                  }}
                />
                <FieldProblem errors={errors} path={`media.${String(i)}.alt`} />
              </label>
              <button
                type="button"
                className={ui.button}
                aria-label={`Remove image ${n}`}
                onClick={() => {
                  set({ media: form.media.filter((_, at) => at !== i) });
                }}
              >
                Remove
              </button>
            </div>
          );
        })}
        <div>
          <button
            type="button"
            className={ui.button}
            disabled={form.media.length >= MAX_MEDIA}
            onClick={() => {
              onChange(addMedia(form));
            }}
          >
            Add image
          </button>
        </div>
      </fieldset>

      {form.format === 'mcq' && (
        <fieldset className={ui.fieldset}>
          <legend>Variants</legend>
          <div className={ui.row}>
            <label className={ui.choice}>
              <input
                type="radio"
                name="variants"
                checked={!form.parameterised}
                onChange={() => {
                  set({ parameterised: false });
                }}
              />
              <span>Fixed</span>
            </label>
            <label className={ui.choice}>
              <input
                type="radio"
                name="variants"
                checked={form.parameterised}
                onChange={() => {
                  set({ parameterised: true });
                }}
              />
              <span>Parameterised</span>
            </label>
          </div>
          {form.parameterised && <SpecEditor form={form} errors={errors} onChange={onChange} />}
        </fieldset>
      )}
      {general.map((e) => (
        <p key={e.message} role="alert" className={ui.alert}>
          {e.message}
        </p>
      ))}
    </div>
  );
}
