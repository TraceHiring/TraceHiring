// The v2 sections editor (specs/m1-test-authoring.md §6.5, §6.1): per section the question source (written here, or a
// draw from a pool with strata quotas), navigation, a timer and shuffle flags. A written section's paste rule is shown
// read-only: it is always the test's paste_written integrity setting (rule 3; the publish guard refuses any other), so
// there is no per-section choice. The test-wide publish rules of a v2 draft (weights add up to 100, timers on every
// section or none) are shown under the sections. Controls are text fields, selects and buttons only (no checkbox: the
// recruiter guards ban row selection). Every value is React text. The component works on the pure model in
// editor-v2-model.ts; the wizard on /tests/:testId mounts it as step 2 of a v2 draft (R5-69) and passes `renderItems`,
// D1's item editor for the questions of an inline section (R5-69 d).
import type { PoolDetail } from '@trace/shared/contracts/m1';
import type { ReactNode } from 'react';
import ui from '../common/Ui.module.css';
import { valueLabel } from '../settings/integrity-model';
import {
  MAX_SECTIONS,
  addSection,
  addStratum,
  moveSection,
  pasteRuleOf,
  poolGap,
  removeSection,
  removeStratum,
  sectionIssues,
  setDrawCount,
  setFormat,
  setMode,
  setNavigation,
  setPool,
  setShuffle,
  setTimeLimitMinutes,
  strataSum,
  updateStratum,
  weightSum,
  type EditorV2Form,
  type SectionForm,
  type SectionIssueCode,
} from './editor-v2-model';

const ISSUE_TEXT: Readonly<Record<Exclude<SectionIssueCode, 'weights_sum'>, string>> = {
  name: 'Give the section a name.',
  weight: 'The weight is a whole number from 1 to 100.',
  pool_missing: 'Choose a pool to draw from.',
  draw_count: 'The number of questions to draw is a whole number from 1 to 100.',
  strata_skill: 'Each stratum needs a skill key of lower-case letters, digits and underscores.',
  strata_count: 'Each stratum needs a count of at least 1.',
  strata_sum: 'The strata must add up to the number of questions to draw.',
  strata_duplicate: 'Use each skill and level once.',
  time_limit: 'The time limit is from 1 to 120 minutes.',
  timers_mixed: 'Give every section a time limit, or none, to publish.',
};

const issueText = (code: SectionIssueCode, form: EditorV2Form): string =>
  code === 'weights_sum'
    ? `Section weights add up to ${weightSum(form)}. They must add up to 100 to publish.`
    : ISSUE_TEXT[code];

function TextField({
  label,
  value,
  disabled,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange(value: string): void;
  placeholder?: string;
}) {
  return (
    <label className={ui.field}>
      <span className={ui.label}>{label}</span>
      <input
        className={ui.input}
        type="text"
        value={value}
        disabled={disabled}
        maxLength={120}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  disabled,
  options,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  options: readonly { value: string; text: string }[];
  onChange(value: string): void;
}) {
  return (
    <label className={ui.field}>
      <span className={ui.label}>{label}</span>
      <select
        className={ui.select}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.text}
          </option>
        ))}
      </select>
    </label>
  );
}

const ON_OFF = [
  { value: 'off', text: 'Off' },
  { value: 'on', text: 'On' },
];
const LEVELS = [0, 1, 2, 3, 4].map((n) => ({ value: String(n), text: `Level ${n}` }));

function PoolBlock({
  section,
  pools,
  disabled,
  onChange,
}: {
  section: SectionForm;
  pools: readonly PoolDetail[];
  disabled: boolean;
  onChange(next: SectionForm): void;
}) {
  const pool = pools.find((p) => p.id === section.poolId);
  const listed = pools
    .filter((p) => p.format === section.format)
    .map((p) => ({ value: p.id, text: `${p.name} (${p.approvedCount} approved)` }));
  // R5-70 e: a stored pool not in the pages loaded so far is still the section's pool, never "Choose a pool".
  const options =
    section.poolId !== '' && pool === undefined
      ? [{ value: section.poolId, text: 'Current pool' }, ...listed]
      : [{ value: '', text: 'Choose a pool' }, ...listed];
  const draw = Number(section.drawCount);
  const gap = pool !== undefined && draw >= 1 ? poolGap(pool.approvedCount, draw) : null;
  return (
    <div className={ui.stack}>
      <SelectField
        label="Pool"
        value={section.poolId}
        disabled={disabled}
        options={options}
        onChange={(v) => {
          onChange(setPool(section, v));
        }}
      />
      <TextField
        label="Questions to draw"
        value={section.drawCount}
        disabled={disabled}
        onChange={(v) => {
          onChange(setDrawCount(section, v));
        }}
      />
      {pool !== undefined && (
        <p className={ui.note}>
          {`This pool has ${pool.approvedCount} approved items.`}
          {gap !== null && gap.forPublish > 0 && ` Needs ${gap.forPublish} more items to publish.`}
          {gap !== null && gap.forDrives > 0 && ` Needs ${gap.forDrives} more items for drives.`}
        </p>
      )}
      <fieldset className={ui.fieldset}>
        <legend className={ui.label}>Strata</legend>
        {section.strata.length === 0 && (
          <p className={ui.note}>No strata: questions are drawn from the whole pool.</p>
        )}
        {section.strata.map((stratum, i) => (
          <div key={i} className={ui.row}>
            <TextField
              label="Skill"
              value={stratum.skillKey}
              disabled={disabled}
              onChange={(skillKey) => {
                onChange(updateStratum(section, i, { skillKey }));
              }}
            />
            <SelectField
              label="Level"
              value={String(stratum.level)}
              disabled={disabled}
              options={LEVELS}
              onChange={(v) => {
                onChange(updateStratum(section, i, { level: Number(v) }));
              }}
            />
            <TextField
              label="Count"
              value={stratum.count}
              disabled={disabled}
              onChange={(count) => {
                onChange(updateStratum(section, i, { count }));
              }}
            />
            {!disabled && (
              <button
                type="button"
                className={ui.button}
                onClick={() => {
                  onChange(removeStratum(section, i));
                }}
              >
                {`Remove stratum ${i + 1}`}
              </button>
            )}
          </div>
        ))}
        {section.strata.length > 0 && (
          <p className={ui.note}>
            {`Strata add up to ${strataSum(section)} of ${section.drawCount === '' ? '?' : section.drawCount} questions.`}
          </p>
        )}
        {!disabled && (
          <button
            type="button"
            className={ui.button}
            onClick={() => {
              onChange(addStratum(section));
            }}
          >
            Add a stratum
          </button>
        )}
      </fieldset>
    </div>
  );
}

function SectionPanel({
  index,
  count,
  section,
  pools,
  issues,
  disabled,
  onSection,
  onForm,
  form,
  renderItems,
}: {
  index: number;
  count: number;
  section: SectionForm;
  pools: readonly PoolDetail[];
  issues: readonly SectionIssueCode[];
  disabled: boolean;
  onSection(next: SectionForm): void;
  onForm(next: EditorV2Form): void;
  form: EditorV2Form;
  renderItems: RenderItems | undefined;
}) {
  const written = section.format === 'written';
  const n = index + 1;
  return (
    <li className={ui.panel} data-section={section.key}>
      <div className={ui.stack}>
        <h4 className={ui.subtitle}>{`Section ${n}`}</h4>
        <div className={ui.row}>
          <TextField
            label="Section name"
            value={section.name}
            disabled={disabled}
            onChange={(name) => {
              onSection({ ...section, name });
            }}
          />
          <TextField
            label="Weight"
            value={section.weight}
            disabled={disabled}
            onChange={(weight) => {
              onSection({ ...section, weight });
            }}
          />
          <SelectField
            label="Question type"
            value={section.format}
            disabled={disabled || section.items.length > 0}
            options={[
              { value: 'mcq', text: 'Multiple choice' },
              { value: 'written', text: 'Written answer' },
            ]}
            onChange={(v) => {
              onSection(setFormat(section, v === 'written' ? 'written' : 'mcq'));
            }}
          />
          <SelectField
            label="Question source"
            value={section.mode}
            disabled={disabled}
            options={[
              { value: 'inline', text: 'Questions written here' },
              { value: 'pool', text: 'Draw from a pool' },
            ]}
            onChange={(v) => {
              onSection(setMode(section, v === 'pool' ? 'pool' : 'inline'));
            }}
          />
        </div>
        {section.mode === 'inline' && section.items.length > 0 && (
          <p className={ui.note}>
            {`${section.items.length} question${section.items.length === 1 ? '' : 's'} written here. Remove the questions written here before drawing from a pool.`}
          </p>
        )}
        {section.mode === 'inline' && renderItems?.(section, index, onSection)}
        {section.mode === 'pool' && (
          <PoolBlock section={section} pools={pools} disabled={disabled} onChange={onSection} />
        )}
        <div className={ui.row}>
          <SelectField
            label="Navigation"
            value={written ? 'forward_only' : (section.navigation ?? 'free')}
            disabled={disabled || written}
            options={
              written
                ? [{ value: 'forward_only', text: 'Forward only' }]
                : [
                    { value: 'free', text: 'Free: candidates can go back' },
                    { value: 'forward_only', text: 'Forward only' },
                  ]
            }
            onChange={(v) => {
              onSection(setNavigation(section, v === 'free' ? 'free' : 'forward_only'));
            }}
          />
          <TextField
            label="Time limit (minutes)"
            value={
              section.timeLimitSeconds === null
                ? ''
                : String(Math.round(section.timeLimitSeconds / 60))
            }
            placeholder="No limit"
            disabled={disabled}
            onChange={(v) => {
              onSection(setTimeLimitMinutes(section, v));
            }}
          />
          <SelectField
            label="Shuffle questions"
            value={section.shuffleItems ? 'on' : 'off'}
            disabled={disabled}
            options={ON_OFF}
            onChange={(v) => {
              onSection(setShuffle(section, 'items', v === 'on'));
            }}
          />
          {!written && (
            <SelectField
              label="Shuffle answer options"
              value={section.shuffleOptions ? 'on' : 'off'}
              disabled={disabled}
              options={ON_OFF}
              onChange={(v) => {
                onSection(setShuffle(section, 'options', v === 'on'));
              }}
            />
          )}
        </div>
        {written && <p className={ui.note}>A written section is always forward only.</p>}
        {written && (
          <p className={ui.note}>
            {`Paste on written answers: ${valueLabel('paste_written', pasteRuleOf(form))}. Set in the integrity settings.`}
          </p>
        )}
        {issues.map((code) => (
          <p key={code} role="alert" className={ui.alert}>
            {issueText(code, form)}
          </p>
        ))}
        {!disabled && (
          <div className={ui.row}>
            <button
              type="button"
              className={ui.button}
              disabled={index === 0}
              onClick={() => {
                onForm(moveSection(form, index, -1));
              }}
            >
              {`Move section ${n} up`}
            </button>
            <button
              type="button"
              className={ui.button}
              disabled={index === count - 1}
              onClick={() => {
                onForm(moveSection(form, index, 1));
              }}
            >
              {`Move section ${n} down`}
            </button>
            <button
              type="button"
              className={ui.button}
              onClick={() => {
                onForm(removeSection(form, index));
              }}
            >
              {`Remove section ${n}`}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

/** The questions editor of an inline section (the wizard passes D1's item editor; R5-69 d). */
export type RenderItems = (
  section: SectionForm,
  index: number,
  onSection: (next: SectionForm) => void,
) => ReactNode;

export function SectionsEditorView({
  form,
  pools,
  readOnly,
  onChange,
  renderItems,
}: {
  form: EditorV2Form;
  pools: readonly PoolDetail[];
  readOnly: boolean;
  onChange(next: EditorV2Form): void;
  renderItems?: RenderItems;
}): ReactNode {
  const issues = sectionIssues(form);
  return (
    <div className={ui.stack}>
      <h3 className={ui.subtitle}>Sections</h3>
      {form.sections.length === 0 && <p className={ui.note}>No sections yet.</p>}
      <ol className={ui.items}>
        {form.sections.map((section, i) => (
          <SectionPanel
            key={section.key}
            index={i}
            count={form.sections.length}
            section={section}
            pools={pools}
            issues={issues.filter((x) => x.section === i).map((x) => x.code)}
            disabled={readOnly}
            form={form}
            renderItems={renderItems}
            onForm={onChange}
            onSection={(next) => {
              onChange({ ...form, sections: form.sections.map((s, j) => (j === i ? next : s)) });
            }}
          />
        ))}
      </ol>
      {issues
        .filter((x) => x.section === null)
        .map((x) => (
          <p key={x.code} role="alert" className={ui.alert}>
            {issueText(x.code, form)}
          </p>
        ))}
      {!readOnly && (
        <div className={ui.row}>
          <button
            type="button"
            className={ui.button}
            disabled={form.sections.length >= MAX_SECTIONS}
            onClick={() => {
              onChange(addSection(form, 'inline', 'mcq'));
            }}
          >
            Add a multiple-choice section
          </button>
          <button
            type="button"
            className={ui.button}
            disabled={form.sections.length >= MAX_SECTIONS}
            onClick={() => {
              onChange(addSection(form, 'inline', 'written'));
            }}
          >
            Add a written section
          </button>
          <button
            type="button"
            className={ui.button}
            disabled={form.sections.length >= MAX_SECTIONS}
            onClick={() => {
              onChange(addSection(form, 'pool', 'mcq'));
            }}
          >
            Add a pool section
          </button>
        </div>
      )}
    </div>
  );
}
