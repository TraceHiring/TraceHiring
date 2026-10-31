// The test editor screens (specs/d1-demo-slice.md §6.1; specs/m1-test-authoring.md §6.10, R5-69): `/tests/new` is the
// wizard's step 1 (D1's start, with the role-template choice next to it: §6.1, R5-15, R5-55 b; its create path is
// unchanged). `/tests/:testId` shows a draft as steps 2 Questions, 3 Integrity and 4 Review and publish on one page
// (no URL suffix; the h2 stays the test name), or a published version read-only with "Edit as new version". The page
// loads the draft read-model (TestDraftView) and the test's integrity settings. A D1-shaped draft (D1's editor can save
// it unchanged and no settings are stored, wizard-model.ts) keeps D1's editor, labels, `PUT /tests/:testId` save and
// publish exactly; any other draft is a v2 draft (WizardEditor.tsx). Publish opens a dialog with the Q20 freeze copy
// and is refused without a valid cutoff.
import type { IntegritySettingsView, TestDraftView } from '@trace/shared/contracts/m1';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { ApiClient, ApiResult } from '../api/client';
import { createTest, getIntegritySettings, getTest } from '../api/endpoints';
import { useApi, useOrgInfo } from '../api/runtime';
import { errorText } from '../common/messages';
import { useResource } from '../common/useResource';
import ui from '../common/Ui.module.css';
import { NO_ACCESS_TEXT, isStaff } from '../shell/nav';
import { DraftFormView } from './DraftFormView';
import { publishDraft, saveDraft } from './editor-actions';
import { fromDetail, isCutoffValid, toRequest, type DraftForm } from './editor-model';
import { FromTemplateRoute } from './FromTemplateRoute';
import { IntegrityStep } from './IntegrityStep';
import { PublishDialog } from './PublishDialog';
import { isD1Shaped } from './wizard-model';
import {
  EditAsNewVersion,
  EditorFooter,
  MessageLine,
  PendingNote,
  Step,
  StepList,
  V2EditorBody,
  publishedLine,
  type EditorMessage,
} from './WizardEditor';

export { FREEZE_COPY, PublishDialog } from './PublishDialog';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** D1's editor for a D1-shaped draft, and D1's read-only view of a published D1 version. */
function D1EditorBody({
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
  const [form, setFormState] = useState<DraftForm>(() => fromDetail(detail));
  const latest = useRef(form);
  const setForm = (next: DraftForm) => {
    latest.current = next;
    setFormState(next);
  };
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<EditorMessage | null>(null);
  // Once step 3 stored settings the draft is a v2 draft (R5-69 b): the next successful save reloads into that editor.
  const [settingsStored, setSettingsStored] = useState(false);
  // R5-70 e: step 3 has unsaved changes or a save in flight; publish waits for it.
  const [stepPending, setStepPending] = useState(false);
  const draft = detail.version.status === 'draft';
  const testId = detail.test.id;
  const cutoffOk = isCutoffValid(form.qualityCutoff);
  const built = toRequest(form);

  const saveForm = async (reloadAfter: boolean) => {
    setBusy(true);
    const result = await saveDraft(api, testId, detail.version.id, latest.current);
    setBusy(false);
    if (result.ok && reloadAfter) {
      onReload();
      return;
    }
    setMessage(
      result.ok
        ? { kind: 'ok', text: 'Draft saved.' }
        : { kind: 'error', text: errorText(result.code) },
    );
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    await saveForm(settingsStored);
  };
  const publish = async () => {
    setBusy(true);
    const result = await publishDraft(api, testId, detail.version.id, latest.current);
    setBusy(false);
    setDialog(false);
    if (result.ok) onReload();
    else setMessage({ kind: 'error', text: errorText(result.code) });
  };

  if (!draft) {
    return (
      <div className={ui.stack}>
        <p className={ui.note}>{publishedLine(detail.version.versionNo)}</p>
        <EditAsNewVersion api={api} testId={testId} onReload={onReload} />
        <DraftFormView form={form} readOnly onChange={setForm} />
        <EditorFooter testId={testId} />
      </div>
    );
  }
  return (
    <div className={ui.stack}>
      <p className={ui.note}>{`Draft, version ${detail.version.versionNo}`}</p>
      <StepList />
      <Step n={2}>
        <form className={ui.stack} onSubmit={(e) => void save(e)}>
          <DraftFormView form={form} readOnly={false} onChange={setForm} />
          <div className={ui.row}>
            <button type="submit" className={ui.button} disabled={busy || !built.ok}>
              Save draft
            </button>
          </div>
        </form>
      </Step>
      <Step n={3}>
        <IntegrityStep
          api={api}
          testId={testId}
          versionId={detail.version.id}
          initial={integrity}
          onPendingChange={setStepPending}
          onSaved={() => {
            // The settings are stored: save the questions as they are on screen (the api completes the sections,
            // R5-63 b), then reload into the v2 editor. A refused save keeps the screen; the next save reloads.
            setSettingsStored(true);
            void saveForm(true);
          }}
        />
      </Step>
      <Step n={4}>
        {stepPending && <PendingNote />}
        {!cutoffOk && (
          <p role="alert" className={ui.alert}>
            Set an Answer Quality cutoff between 0 and 100 to publish.
          </p>
        )}
        <div className={ui.row}>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={busy || stepPending || !cutoffOk || !built.ok}
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

/**
 * The editor of a loaded test (R5-69 b): D1's editor for a D1-shaped draft or published D1 version, else the v2 one.
 * `integrity` is the test's integrity settings view, or null when it could not be read (the sections then decide).
 */
export function EditorBody({
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
  return isD1Shaped(detail, integrity) ? (
    <D1EditorBody api={api} detail={detail} integrity={integrity} onReload={onReload} />
  ) : (
    <V2EditorBody api={api} detail={detail} integrity={integrity} onReload={onReload} />
  );
}

/**
 * The loader of the test detail, or null when the caller is not staff (owner, admin, recruiter): then nothing is
 * requested at all. This is UX only; the server refuses a reviewer too.
 */
export function testDetailLoader(
  api: ApiClient,
  testId: string,
  roles: readonly string[] | null,
): (() => Promise<ApiResult<TestDraftView>>) | null {
  if (roles === null || !isStaff(roles)) return null;
  return () => getTest(api, testId);
}

export interface EditorData {
  detail: TestDraftView;
  /** Null when the settings could not be read (EditorBody then decides from the sections). */
  integrity: IntegritySettingsView | null;
}

/** The test detail, then its integrity settings (staff only, as `testDetailLoader`). */
export function editorLoader(
  api: ApiClient,
  testId: string,
  roles: readonly string[] | null,
): (() => Promise<ApiResult<EditorData>>) | null {
  const loadDetail = testDetailLoader(api, testId, roles);
  if (loadDetail === null) return null;
  return async () => {
    const detail = await loadDetail();
    if (!detail.ok) return detail;
    const integrity = await getIntegritySettings(api, testId);
    return {
      ok: true,
      data: { detail: detail.data, integrity: integrity.ok ? integrity.data : null },
    };
  };
}

/** Route `/tests/:testId`. */
export function TestEditorRoute() {
  const { testId } = useParams();
  const api = useApi();
  const info = useOrgInfo();
  const roles = info === null ? null : info.roles;
  const staff = roles !== null && isStaff(roles);
  const valid = testId !== undefined && UUID.test(testId);
  const load = useMemo(
    () =>
      api !== null && valid
        ? editorLoader(api, testId, roles)
        : staff
          ? () => Promise.resolve({ ok: false as const, code: 'not_found' })
          : null,
    [api, testId, valid, roles, staff],
  );
  const [state, reload] = useResource(load);
  if (!staff) {
    return (
      <section className={ui.stack}>
        <h2 className={ui.title}>Test</h2>
        <p role="status">{NO_ACCESS_TEXT}</p>
      </section>
    );
  }
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>{state.kind === 'ready' ? state.data.detail.test.name : 'Test'}</h2>
      {state.kind === 'loading' && <p role="status">Loading...</p>}
      {state.kind === 'error' && (
        <p role="alert" className={ui.alert}>
          {errorText(state.code)}
        </p>
      )}
      {state.kind === 'ready' && api !== null && (
        <EditorBody
          // A new key per loaded version and editor resets the form after a publish, a new version or new settings.
          key={`${state.data.detail.version.id}-${state.data.detail.version.status}-${
            isD1Shaped(state.data.detail, state.data.integrity) ? 'd1' : 'v2'
          }`}
          api={api}
          detail={state.data.detail}
          integrity={state.data.integrity}
          onReload={reload}
        />
      )}
    </section>
  );
}

/**
 * Route `/tests/new`, the wizard's step 1: D1's start (names the test, creates the draft with cutoff 40 and opens it)
 * and, for staff, the role-template choice next to it (§6.1; UX gating only, the server refuses others).
 */
export function NewTestRoute() {
  const api = useApi();
  const info = useOrgInfo();
  const staff = info !== null && isStaff(info.roles);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (api === null) return;
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    if (name === '' || name.length > 200) {
      setError('bad_request');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createTest(api, { name });
    setBusy(false);
    if (result.ok) void navigate(`/tests/${result.data.test.id}`);
    else setError(result.code);
  };
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>New test</h2>
      <StepList current={1} />
      <form className={ui.form} onSubmit={(e) => void submit(e)}>
        <label className={ui.field}>
          <span className={ui.label}>Test name</span>
          <input className={ui.input} name="name" type="text" maxLength={200} required />
        </label>
        <p className={ui.note}>
          The test starts as a draft with an Answer Quality cutoff of 40. You can change the cutoff
          until you publish.
        </p>
        <button type="submit" className={ui.button} disabled={busy || api === null}>
          Create draft
        </button>
      </form>
      {error !== null && (
        <p role="alert" className={ui.alert}>
          {errorText(error)}
        </p>
      )}
      {staff && <FromTemplateRoute embedded />}
    </section>
  );
}
