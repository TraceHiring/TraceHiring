// The recruiter wizard on `/tests/:testId` (specs/m1-test-authoring.md §6.10; R5-69): the step list, the v2 editor
// (step 2 Questions: the test fields, the sections editor with D1's item editor for inline sections and the pool
// picker; step 3 Integrity; step 4 Review and publish) and "Edit as new version" for a published version. A D1-shaped
// draft keeps D1's editor (TestEditorPage). Everything is React text from synthetic or api data; no checkbox and no
// `aria-selected` (R5-55 c); the words follow the recruiter guards (d1-guards / m1-guards word lists).
import type { IntegritySettingsView, PoolDetail, TestDraftView } from '@trace/shared/contracts/m1';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { ApiClient } from '../api/client';
import { listPools } from '../api/endpoints';
import { errorText } from '../common/messages';
import ui from '../common/Ui.module.css';
import { SectionItems } from './DraftFormView';
import { editAsNewVersion, publishDraftV2, saveDraftV2 } from './editor-actions';
import { MAX_ITEMS, emptyDraft, setCutoffInput, type DraftForm } from './editor-model';
import {
  isCutoffValid,
  sectionIssues,
  setPasteWritten,
  toSaveTestDraftRequest,
  type EditorV2Form,
  type SectionForm,
} from './editor-v2-model';
import { IntegrityStep } from './IntegrityStep';
import { PublishDialog } from './PublishDialog';
import { ReviewersPanel } from './ReviewersPanel';
import { SectionsEditorView } from './SectionsEditor';
import { draftItemOf, inlineItemCount, itemFormOf, v2FormOf } from './wizard-model';

// ---- steps ----------------------------------------------------------------------------------------------------------

/** The wizard's steps (§6.10): step 1 is `/tests/new`, steps 2 to 4 are one page on `/tests/:testId`. */
export const STEP_TITLES = ['Job details', 'Questions', 'Integrity', 'Review and publish'] as const;

export function StepList({ current }: { current?: number }) {
  return (
    <ol className={ui.nav} aria-label="Steps">
      {STEP_TITLES.map((title, i) => (
        <li key={title} aria-current={current === i + 1 ? 'step' : undefined}>
          {`${i + 1}. ${title}`}
        </li>
      ))}
    </ol>
  );
}

/** One step of the draft page: a region headed "Step <n>: <title>". */
export function Step({ n, children }: { n: 2 | 3 | 4; children: ReactNode }) {
  const id = `step-${n}`;
  return (
    <section className={ui.stack} aria-labelledby={id}>
      <h3 id={id} className={ui.subtitle}>
        {`Step ${n}: ${STEP_TITLES[n - 1]}`}
      </h3>
      {children}
    </section>
  );
}

export interface EditorMessage {
  kind: 'ok' | 'error';
  text: string;
}

export function MessageLine({ message }: { message: EditorMessage | null }) {
  if (message === null) return null;
  return (
    <p
      role={message.kind === 'error' ? 'alert' : 'status'}
      className={message.kind === 'error' ? ui.alert : ui.note}
    >
      {message.text}
    </p>
  );
}

/** The line above a published version (R5-69 g: no "later release"; a change is a new version). */
export const publishedLine = (versionNo: number): string =>
  `Published, version ${versionNo}. Settings are frozen; to change the test, edit it as a new version.`;

/** The links and the reviewers region under every editor (D1). */
export function EditorFooter({ testId }: { testId: string }) {
  return (
    <>
      <p className={ui.row}>
        <Link to={`/tests/${testId}/invite`}>Invite a candidate</Link>
        <Link to={`/tests/${testId}/results`}>Results</Link>
      </p>
      <ReviewersPanel testId={testId} />
    </>
  );
}

// ---- "Edit as new version" (R5-69 g) -------------------------------------------------------------------------------

/** `outcome`: null before a try, `already_open` after a 409 (a draft is open), else the failure code. */
export function EditAsNewVersionView({
  testId,
  busy,
  outcome,
  onEdit,
  onOpen,
}: {
  testId: string;
  busy: boolean;
  outcome: string | null;
  onEdit(): void;
  onOpen(): void;
}) {
  return (
    <div className={ui.stack}>
      <div className={ui.row}>
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={busy}
          onClick={onEdit}
        >
          Edit as new version
        </button>
      </div>
      {outcome === 'already_open' && (
        <p role="status" className={ui.note}>
          A draft of this test is already open.{' '}
          <Link to={`/tests/${testId}`} onClick={onOpen}>
            Open the draft
          </Link>
        </p>
      )}
      {outcome !== null && outcome !== 'already_open' && (
        <p role="alert" className={ui.alert}>
          {errorText(outcome)}
        </p>
      )}
    </div>
  );
}

/** Clones the published version into a new draft and reloads the page onto it. */
export function EditAsNewVersion({
  api,
  testId,
  onReload,
}: {
  api: ApiClient;
  testId: string;
  onReload(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const edit = async () => {
    setBusy(true);
    const result = await editAsNewVersion(api, testId);
    setBusy(false);
    if (result.ok) onReload();
    else setOutcome(result.code === 'conflict' ? 'already_open' : result.code);
  };
  return (
    <EditAsNewVersionView
      testId={testId}
      busy={busy}
      outcome={outcome}
      onEdit={() => void edit()}
      onOpen={onReload}
    />
  );
}

// ---- step 2 of a v2 draft --------------------------------------------------------------------------------------------

function TestFields({
  form,
  readOnly,
  onChange,
}: {
  form: EditorV2Form;
  readOnly: boolean;
  onChange(next: EditorV2Form): void;
}) {
  return (
    <div className={ui.stack}>
      <label className={ui.field}>
        <span className={ui.label}>Test name</span>
        <input
          className={ui.input}
          type="text"
          value={form.name}
          disabled={readOnly}
          maxLength={200}
          onChange={(e) => {
            onChange({ ...form, name: e.target.value });
          }}
        />
      </label>
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
    </div>
  );
}

/** D1's form around one inline section's items, so D1's item editor can edit them (R5-69 d). */
function itemsForm(section: SectionForm): DraftForm {
  const form = emptyDraft('');
  form[section.format] = { name: '', weight: '', items: section.items.map(itemFormOf) };
  return form;
}

/**
 * The questions of a v2 inline section, edited with D1's item editor (same per-question limits; at most 10 questions
 * written here across the test, D1's limit). The typed text is kept here; the section takes the converted items.
 */
function InlineItemsEditor({
  section,
  readOnly,
  full,
  onSection,
}: {
  section: SectionForm;
  readOnly: boolean;
  full: boolean;
  onSection(next: SectionForm): void;
}) {
  const [form, setForm] = useState<DraftForm>(() => itemsForm(section));
  const which = section.format;
  return (
    <SectionItems
      which={which}
      form={form}
      readOnly={readOnly}
      full={full}
      keyPrefix={`${section.key}-`}
      onChange={(next) => {
        setForm(next);
        onSection({ ...section, items: next[which].items.map(draftItemOf) });
      }}
    />
  );
}

interface PoolsState {
  pools: PoolDetail[];
  next: string | null;
  error: string | null;
}

/**
 * The pools the caller can see, page by page (`listPools`, RLS-scoped; R5-69 e). There is no client workspace filter:
 * the database refuses a pool of another workspace than the test's (sections_pool_fk).
 */
function usePools(api: ApiClient): [PoolsState, () => void] {
  const [state, setState] = useState<PoolsState>({ pools: [], next: null, error: null });
  useEffect(() => {
    let live = true;
    void listPools(api, {}).then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? { pools: result.data.pools, next: result.data.nextCursor, error: null }
          : { pools: [], next: null, error: result.code },
      );
    });
    return () => {
      live = false;
    };
  }, [api]);
  const more = () => {
    const cursor = state.next;
    if (cursor === null) return;
    void listPools(api, { cursor }).then((result) => {
      setState((s) =>
        result.ok
          ? {
              pools: [
                ...s.pools,
                ...result.data.pools.filter((p) => !s.pools.some((q) => q.id === p.id)),
              ],
              next: result.data.nextCursor,
              error: null,
            }
          : { ...s, error: result.code },
      );
    });
  };
  return [state, more];
}

// ---- the v2 editor -------------------------------------------------------------------------------------------------

/**
 * A v2 draft (or published v2 version): step 2 Questions, step 3 Integrity, step 4 Review and publish. Save is
 * `PUT …/draft`; publish saves, then publishes the version (R5-69 b). Saving the integrity step makes every written
 * section follow `paste_written` and saves the draft again, so the publish uses the settings just saved (R5-69 c).
 */
export function V2EditorBody({
  api,
  detail,
  integrity,
  onReload,
}: {
  api: ApiClient;
  detail: TestDraftView;
  integrity: IntegritySettingsView | null;
  onReload(): void;
}) {
  const [form, setFormState] = useState<EditorV2Form>(() => v2FormOf(detail, integrity));
  const latest = useRef(form);
  const setForm = (next: EditorV2Form) => {
    latest.current = next;
    setFormState(next);
  };
  const [pools, morePools] = usePools(api);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<EditorMessage | null>(null);
  const draft = detail.version.status === 'draft';
  const testId = detail.test.id;
  const cutoffOk = isCutoffValid(form.qualityCutoff);
  const built = toSaveTestDraftRequest(form);
  const issues = sectionIssues(form);
  const full = inlineItemCount(form) >= MAX_ITEMS;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const result = await saveDraftV2(api, latest.current);
    setBusy(false);
    setMessage(
      result.ok
        ? { kind: 'ok', text: 'Draft saved.' }
        : { kind: 'error', text: errorText(result.code) },
    );
  };
  const publish = async () => {
    setBusy(true);
    const result = await publishDraftV2(api, latest.current);
    setBusy(false);
    setDialog(false);
    if (result.ok) onReload();
    else setMessage({ kind: 'error', text: errorText(result.code) });
  };
  const settingsSaved = async (saved: IntegritySettingsView) => {
    const next = setPasteWritten(latest.current, saved.values.paste_written);
    setForm(next);
    setBusy(true);
    const result = await saveDraftV2(api, next);
    setBusy(false);
    setMessage(
      result.ok
        ? { kind: 'ok', text: 'Settings saved. The draft follows them.' }
        : { kind: 'error', text: errorText(result.code) },
    );
  };

  const questions = (
    <form className={ui.stack} onSubmit={(e) => void save(e)}>
      <TestFields form={form} readOnly={!draft} onChange={setForm} />
      <SectionsEditorView
        form={form}
        pools={pools.pools}
        readOnly={!draft}
        onChange={setForm}
        renderItems={(section, _index, onSection) => (
          <InlineItemsEditor
            section={section}
            readOnly={!draft}
            full={full}
            onSection={onSection}
          />
        )}
      />
      {pools.next !== null && (
        <div className={ui.row}>
          <button type="button" className={ui.button} onClick={morePools}>
            Show more pools
          </button>
        </div>
      )}
      {pools.error !== null && (
        <p role="alert" className={ui.alert}>
          {errorText(pools.error)}
        </p>
      )}
      {draft && (
        <div className={ui.row}>
          <button type="submit" className={ui.button} disabled={busy || !built.ok}>
            Save draft
          </button>
        </div>
      )}
    </form>
  );
  const settings = (
    <IntegrityStep
      api={api}
      testId={testId}
      readOnly={!draft}
      initial={integrity}
      onSaved={(saved) => void settingsSaved(saved)}
    />
  );

  if (!draft) {
    return (
      <div className={ui.stack}>
        <p className={ui.note}>{publishedLine(detail.version.versionNo)}</p>
        <EditAsNewVersion api={api} testId={testId} onReload={onReload} />
        {questions}
        {settings}
        <EditorFooter testId={testId} />
      </div>
    );
  }
  return (
    <div className={ui.stack}>
      <p className={ui.note}>{`Draft, version ${detail.version.versionNo}`}</p>
      <StepList />
      <Step n={2}>{questions}</Step>
      <Step n={3}>{settings}</Step>
      <Step n={4}>
        <ReviewSummary form={form} issueCount={issues.length} />
        {!cutoffOk && (
          <p role="alert" className={ui.alert}>
            Set an Answer Quality cutoff between 0 and 100 to publish.
          </p>
        )}
        <div className={ui.row}>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={busy || !cutoffOk || !built.ok}
            onClick={() => {
              setDialog(true);
            }}
          >
            Publish...
          </button>
        </div>
      </Step>
      {dialog && (
        <PublishDialog
          busy={busy}
          onPublish={() => void publish()}
          onCancel={() => {
            setDialog(false);
          }}
        />
      )}
      <MessageLine message={message} />
      <EditorFooter testId={testId} />
    </div>
  );
}

/** Step 4's summary: each section's source, and what still stands in the way of a publish. */
function ReviewSummary({ form, issueCount }: { form: EditorV2Form; issueCount: number }) {
  return (
    <div className={ui.stack}>
      <ul>
        {form.sections.map((s) => (
          <li key={s.key}>
            {s.mode === 'pool'
              ? `${s.name}: draws ${s.drawCount === '' ? '?' : s.drawCount} questions from a pool, weight ${s.weight}`
              : `${s.name}: ${s.items.length} question${s.items.length === 1 ? '' : 's'} written here, weight ${s.weight}`}
          </li>
        ))}
      </ul>
      {form.sections.length === 0 && <p className={ui.note}>No sections yet.</p>}
      {form.pasteWritten === null && (
        <p className={ui.note}>Save the integrity settings in step 3 before you publish.</p>
      )}
      {issueCount > 0 && (
        <p className={ui.note}>Some sections need changes in step 2 before you publish.</p>
      )}
    </div>
  );
}
