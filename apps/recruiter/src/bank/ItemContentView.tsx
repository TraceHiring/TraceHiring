// The read-only view of one stored item version (specs/m1-test-authoring.md §3.3, §4.1, §6.2, §6.4). The answer key
// and the parameter spec appear only when the api sent them; a library-sourced item never has either (I-M1-5,
// SEC-M1-1), and the screen says so. Every value is rendered as React text; images are shown as key and alt text.
import type { BankItemDetail, ParamSpec } from '@trace/shared/contracts/m1';
import { formatTime } from '../common/format';
import ui from '../common/Ui.module.css';
import { AI_DRAFT_BADGE, FORMAT_LABEL, ORIGIN_LABEL, STATUS_LABEL, difficultyText } from './labels';

type Spec = ParamSpec;

function paramText(name: string, def: Spec['params'][string]): string {
  return def.kind === 'int'
    ? `${name}: whole number ${String(def.min)} to ${String(def.max)}, step ${String(def.step)}`
    : `${name}: one of ${def.values.map(String).join(', ')}`;
}

/** The parameter spec of a parameterised item: templates and ranges, as text. The api generates the variants. */
export function ParamSpecView({ spec }: { spec: Spec }) {
  return (
    <section className={ui.panel} aria-label="Parameter spec">
      <h3 className={ui.subtitle}>Parameter spec</h3>
      <ul className={ui.items}>
        {Object.entries(spec.params).map(([name, def]) => (
          <li key={name}>{paramText(name, def)}</li>
        ))}
        {Object.entries(spec.derived).map(([name, expr]) => (
          <li key={name}>{`${name} = ${expr}`}</li>
        ))}
        {spec.constraints.map((expr) => (
          <li key={expr}>{`Only when ${expr}`}</li>
        ))}
      </ul>
      <p>{spec.stem}</p>
      <ul className={ui.items}>
        {spec.options.map((o) => (
          <li key={o.id}>
            {o.text}
            {o.id === spec.correctOptionId && <strong> (Correct answer)</strong>}
          </li>
        ))}
      </ul>
      <p className={ui.note}>{`${String(spec.count)} variants`}</p>
    </section>
  );
}

export function ItemContentView({ detail }: { detail: BankItemDetail }) {
  const content = detail.content;
  const approvedByAuthor = detail.approvedBy !== null && detail.approvedBy === detail.createdBy;
  return (
    <section className={ui.stack} aria-label="Item content">
      {detail.origin === 'ai_draft' && detail.status === 'in_review' && (
        <p className={ui.banner}>{AI_DRAFT_BADGE}</p>
      )}
      <p className={ui.note}>
        {`${STATUS_LABEL[detail.status]} · Version ${String(detail.versionNo)} · ${ORIGIN_LABEL[detail.origin]} · ${FORMAT_LABEL[content.format]}${detail.isParameterised ? ' � Parameterised' : ''}`}
      </p>
      <p className={ui.note}>
        {`Skill ${content.skillKey} · Difficulty ${difficultyText(content.difficulty)} · Times served: ${String(detail.exposureCount)}`}
      </p>
      {detail.approvedAt !== null && (
        <p className={ui.note}>
          {`Approved on ${formatTime(detail.approvedAt)}${approvedByAuthor ? ' by its author (self-approval)' : ''}`}
        </p>
      )}
      <p>{content.stem}</p>
      {content.media !== undefined && (
        <ul className={ui.items} aria-label="Images">
          {content.media.map((m) => (
            <li key={m.key}>
              <span className={ui.mono}>{m.key}</span>
              {` · Alt text: ${m.alt}`}
            </li>
          ))}
        </ul>
      )}
      {content.format === 'mcq' ? (
        <ul className={ui.items} aria-label="Options">
          {content.options.map((o) => (
            <li key={o.id}>
              {o.text}
              {content.key?.optionId === o.id && <strong> (Correct answer)</strong>}
            </li>
          ))}
        </ul>
      ) : (
        <p className={ui.note}>
          {'Rubric version '}
          <span className={ui.mono}>{content.rubricVersionId}</span>
        </p>
      )}
      {detail.librarySourced && (
        <p className={ui.note}>
          The answer key and variant settings of library items are not shown.
        </p>
      )}
      {content.format === 'mcq' && content.paramSpec !== undefined && (
        <ParamSpecView spec={content.paramSpec} />
      )}
    </section>
  );
}
