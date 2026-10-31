// The editor form (specs/d1-demo-slice.md §6.1): name, duration, the mandatory Answer Quality cutoff, one MCQ
// section and one written section with at most 10 items in all. There is no paste-policy control. When
// `readOnly` (a published version) every field is disabled and nothing can be added or removed.
import ui from '../common/Ui.module.css';
import {
  MAX_ITEMS,
  addCriterion,
  addMcqItem,
  addOption,
  addWrittenItem,
  itemCount,
  removeCriterion,
  removeItem,
  removeOption,
  setCutoffInput,
  updateItem,
  type CriterionForm,
  type DraftForm,
  type McqItemForm,
  type SectionKey,
  type WrittenItemForm,
} from './editor-model';

interface Props {
  form: DraftForm;
  readOnly: boolean;
  onChange(next: DraftForm): void;
}

function Text({
  label,
  value,
  disabled,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange(value: string): void;
  multiline?: boolean;
}) {
  return (
    <label className={ui.field}>
      <span className={ui.label}>{label}</span>
      {multiline ? (
        <textarea
          className={ui.textarea}
          value={value}
          disabled={disabled}
          maxLength={4000}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      ) : (
        <input
          className={ui.input}
          type="text"
          value={value}
          disabled={disabled}
          maxLength={500}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      )}
    </label>
  );
}

function McqItem({
  item,
  index,
  form,
  readOnly,
  onChange,
  keyPrefix,
}: { item: McqItemForm; index: number; keyPrefix: string } & Props) {
  const set = (next: McqItemForm) => {
    onChange(updateItem(form, 'mcq', index, next));
  };
  const name = `${keyPrefix}mcq-key-${index}`;
  return (
    <li className={ui.panel}>
      <h4 className={ui.subtitle}>Question {index + 1} (multiple choice)</h4>
      <Text
        label="Question text"
        value={item.prompt}
        multiline
        disabled={readOnly}
        onChange={(prompt) => {
          set({ ...item, prompt });
        }}
      />
      <fieldset className={ui.fieldset}>
        <legend className={ui.label}>Options (mark the correct one)</legend>
        {item.options.map((option, optionIndex) => (
          <div key={option.id} className={ui.row}>
            <label className={ui.choice}>
              <input
                type="radio"
                name={name}
                checked={item.correctOptionId === option.id}
                disabled={readOnly}
                onChange={() => {
                  set({ ...item, correctOptionId: option.id });
                }}
              />
              <span>Correct</span>
            </label>
            <Text
              label={`Option ${optionIndex + 1}`}
              value={option.text}
              disabled={readOnly}
              onChange={(text) => {
                set({
                  ...item,
                  options: item.options.map((o) => (o.id === option.id ? { ...o, text } : o)),
                });
              }}
            />
            {!readOnly && item.options.length > 2 && (
              <button
                type="button"
                className={ui.button}
                onClick={() => {
                  onChange(removeOption(form, index, optionIndex));
                }}
              >
                Remove option {optionIndex + 1}
              </button>
            )}
          </div>
        ))}
        {!readOnly && item.options.length < 6 && (
          <button
            type="button"
            className={ui.button}
            onClick={() => {
              onChange(addOption(form, index));
            }}
          >
            Add option
          </button>
        )}
      </fieldset>
      {!readOnly && (
        <button
          type="button"
          className={ui.button}
          onClick={() => {
            onChange(removeItem(form, 'mcq', index));
          }}
        >
          Remove question {index + 1}
        </button>
      )}
    </li>
  );
}

function Criterion({
  criterion,
  number,
  disabled,
  canRemove,
  onChange,
  onRemove,
}: {
  criterion: CriterionForm;
  number: number;
  disabled: boolean;
  canRemove: boolean;
  onChange(next: CriterionForm): void;
  onRemove(): void;
}) {
  return (
    <fieldset className={ui.fieldset}>
      <legend className={ui.label}>Criterion {number}</legend>
      <Text
        label="Label"
        value={criterion.label}
        disabled={disabled}
        onChange={(label) => {
          onChange({ ...criterion, label });
        }}
      />
      <Text
        label="Anchors (comma-separated words or phrases)"
        value={criterion.anchors}
        disabled={disabled}
        onChange={(anchors) => {
          onChange({ ...criterion, anchors });
        }}
      />
      <div className={ui.row}>
        <Text
          label="Maximum points"
          value={criterion.maxPoints}
          disabled={disabled}
          onChange={(maxPoints) => {
            onChange({ ...criterion, maxPoints });
          }}
        />
        <Text
          label="Anchors needed"
          value={criterion.minHits}
          disabled={disabled}
          onChange={(minHits) => {
            onChange({ ...criterion, minHits });
          }}
        />
      </div>
      {!disabled && canRemove && (
        <button type="button" className={ui.button} onClick={onRemove}>
          Remove criterion {number}
        </button>
      )}
    </fieldset>
  );
}

function WrittenItem({
  item,
  index,
  form,
  readOnly,
  onChange,
}: { item: WrittenItemForm; index: number } & Props) {
  const set = (next: WrittenItemForm) => {
    onChange(updateItem(form, 'written', index, next));
  };
  return (
    <li className={ui.panel}>
      <h4 className={ui.subtitle}>Question {index + 1} (written)</h4>
      <Text
        label="Question text"
        value={item.prompt}
        multiline
        disabled={readOnly}
        onChange={(prompt) => {
          set({ ...item, prompt });
        }}
      />
      {item.criteria.map((criterion, criterionIndex) => (
        <Criterion
          key={criterion.id}
          criterion={criterion}
          number={criterionIndex + 1}
          disabled={readOnly}
          canRemove={item.criteria.length > 1}
          onChange={(next) => {
            set({
              ...item,
              criteria: item.criteria.map((c) => (c.id === criterion.id ? next : c)),
            });
          }}
          onRemove={() => {
            onChange(removeCriterion(form, index, criterionIndex));
          }}
        />
      ))}
      {!readOnly && item.criteria.length < 8 && (
        <button
          type="button"
          className={ui.button}
          onClick={() => {
            onChange(addCriterion(form, index));
          }}
        >
          Add criterion
        </button>
      )}
      {!readOnly && (
        <button
          type="button"
          className={ui.button}
          onClick={() => {
            onChange(removeItem(form, 'written', index));
          }}
        >
          Remove question {index + 1}
        </button>
      )}
    </li>
  );
}

/**
 * The questions of one section and its "Add question" button: D1's item editor. Exported for the v2 editor's inline
 * sections (specs/m1-test-authoring.md R5-69 d), which pass `full` (D1's limit of 10 questions counts the whole test)
 * and a `keyPrefix` that keeps each section's answer-key radio groups apart.
 */
export function SectionItems({
  which,
  form,
  readOnly,
  onChange,
  full = itemCount(form) >= MAX_ITEMS,
  keyPrefix = '',
}: { which: SectionKey; full?: boolean; keyPrefix?: string } & Props) {
  const section = form[which];
  return (
    <>
      <ol className={ui.items}>
        {section.items.map((item, index) =>
          item.format === 'mcq' ? (
            <McqItem
              key={`${which}-${index}`}
              item={item}
              index={index}
              form={form}
              readOnly={readOnly}
              onChange={onChange}
              keyPrefix={keyPrefix}
            />
          ) : (
            <WrittenItem
              key={`${which}-${index}`}
              item={item}
              index={index}
              form={form}
              readOnly={readOnly}
              onChange={onChange}
            />
          ),
        )}
      </ol>
      {!readOnly && (
        <button
          type="button"
          className={ui.button}
          disabled={full}
          onClick={() => {
            onChange(which === 'mcq' ? addMcqItem(form) : addWrittenItem(form));
          }}
        >
          Add question
        </button>
      )}
    </>
  );
}

function Section({ which, form, readOnly, onChange }: { which: SectionKey } & Props) {
  const section = form[which];
  const title = which === 'mcq' ? 'Multiple choice section' : 'Written section';
  return (
    <section className={ui.stack} aria-label={title}>
      <h3 className={ui.subtitle}>{title}</h3>
      <div className={ui.row}>
        <Text
          label="Section name"
          value={section.name}
          disabled={readOnly}
          onChange={(name) => {
            onChange({ ...form, [which]: { ...section, name } });
          }}
        />
        <Text
          label="Section weight (1 to 100)"
          value={section.weight}
          disabled={readOnly}
          onChange={(weight) => {
            onChange({ ...form, [which]: { ...section, weight } });
          }}
        />
      </div>
      <SectionItems which={which} form={form} readOnly={readOnly} onChange={onChange} />
    </section>
  );
}

export function DraftFormView({ form, readOnly, onChange }: Props) {
  return (
    <div className={ui.stack}>
      <Text
        label="Test name"
        value={form.name}
        disabled={readOnly}
        onChange={(name) => {
          onChange({ ...form, name });
        }}
      />
      <label className={ui.field}>
        <span className={ui.label}>Duration (minutes, 5 to 120)</span>
        <input
          className={ui.input}
          type="number"
          min={5}
          max={120}
          step={1}
          value={form.durationMinutes}
          disabled={readOnly}
          required
          onChange={(e) => {
            onChange({ ...form, durationMinutes: e.target.value });
          }}
        />
      </label>
      <label className={ui.field}>
        <span className={ui.label}>Answer Quality cutoff (0 to 100)</span>
        <input
          className={ui.input}
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          value={form.qualityCutoff}
          disabled={readOnly}
          required
          aria-describedby="cutoff-help"
          onChange={(e) => {
            onChange({
              ...form,
              qualityCutoff: setCutoffInput(form.qualityCutoff, e.target.value),
            });
          }}
        />
        <span id="cutoff-help" className={ui.note}>
          Candidates scoring below the cutoff are marked "Below cutoff" in the results. A cutoff is
          always set; it cannot be cleared.
        </span>
      </label>
      <p className={ui.note}>
        Questions: {itemCount(form)} of {MAX_ITEMS}
      </p>
      <Section which="mcq" form={form} readOnly={readOnly} onChange={onChange} />
      <Section which="written" form={form} readOnly={readOnly} onChange={onChange} />
    </div>
  );
}
