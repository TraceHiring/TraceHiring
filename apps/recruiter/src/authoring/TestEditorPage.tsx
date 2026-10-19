// The test editor screens (specs/d1-demo-slice.md §6.1): `/tests/new` creates a draft, `/tests/:testId` edits it
// (draft only; a published version is read-only in D1). Publish opens a dialog with the Q20 freeze copy and is
// refused without a valid cutoff.
import type { TestDetailResponse } from '@trace/shared/contracts/d1';
import { useCallback, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ApiClient } from '../api/client';
import { createTest, getTest } from '../api/endpoints';
import { useApi } from '../api/runtime';
import { errorText } from '../common/messages';
import { useResource } from '../common/useResource';
import ui from '../common/Ui.module.css';
import { DraftFormView } from './DraftFormView';
import { publishDraft, saveDraft } from './editor-actions';
import { fromDetail, isCutoffValid, toRequest, type DraftForm } from './editor-model';
import { ReviewersPanel } from './ReviewersPanel';

export const FREEZE_COPY =
  'Settings freeze when you publish, including the cutoff; later changes create a new version';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function PublishDialog({
  busy,
  onPublish,
  onCancel,
}: {
  busy: boolean;
  onPublish(): void;
  onCancel(): void;
}) {
  return (
    <div className={ui.dialog} role="dialog" aria-labelledby="publish-title" aria-modal="false">
      <h3 id="publish-title" className={ui.subtitle}>
        Publish this test
      </h3>
      <p>{FREEZE_COPY}</p>
      <div className={ui.row}>
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={busy}
          onClick={onPublish}
        >
          Publish test
        </button>
        <button type="button" className={ui.button} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function EditorBody({
  api,
  detail,
  onPublished,
}: {
  api: ApiClient;
  detail: TestDetailResponse;
  onPublished(): void;
}) {
  const [form, setForm] = useState<DraftForm>(() => fromDetail(detail));
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const draft = detail.version.status === 'draft';
  const testId = detail.test.id;
  const cutoffOk = isCutoffValid(form.qualityCutoff);
  const built = toRequest(form);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const result = await saveDraft(api, testId, form);
    setBusy(false);
    setMessage(
      result.ok
        ? { kind: 'ok', text: 'Draft saved.' }
        : { kind: 'error', text: errorText(result.code) },
    );
  };
  const publish = async () => {
    setBusy(true);
    const result = await publishDraft(api, testId, detail.version.id, form);
    setBusy(false);
    setDialog(false);
    if (result.ok) onPublished();
    else setMessage({ kind: 'error', text: errorText(result.code) });
  };

  return (
    <div className={ui.stack}>
      <p className={ui.note}>
        {draft
          ? `Draft, version ${detail.version.versionNo}`
          : `Published, version ${detail.version.versionNo}. Settings are frozen; a new version comes in a later release.`}
      </p>
      <form className={ui.stack} onSubmit={(e) => void save(e)}>
        <DraftFormView form={form} readOnly={!draft} onChange={setForm} />
        {draft && (
          <div className={ui.row}>
            <button type="submit" className={ui.button} disabled={busy || !built.ok}>
              Save draft
            </button>
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
        )}
        {draft && !cutoffOk && (
          <p role="alert" className={ui.alert}>
            Set an Answer Quality cutoff between 0 and 100 to publish.
          </p>
        )}
      </form>
      {dialog && (
        <PublishDialog
          busy={busy}
          onPublish={() => void publish()}
          onCancel={() => {
            setDialog(false);
          }}
        />
      )}
      {message !== null && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={message.kind === 'error' ? ui.alert : ui.note}
        >
          {message.text}
        </p>
      )}
      <p className={ui.row}>
        <Link to={`/tests/${testId}/invite`}>Invite a candidate</Link>
        <Link to={`/tests/${testId}/results`}>Results</Link>
      </p>
      <ReviewersPanel testId={testId} />
    </div>
  );
}

/** Route `/tests/:testId`. */
export function TestEditorRoute() {
  const { testId } = useParams();
  const api = useApi();
  const valid = testId !== undefined && UUID.test(testId);
  const load = useCallback(
    () =>
      api !== null && valid
        ? getTest(api, testId)
        : Promise.resolve({ ok: false as const, code: 'not_found' }),
    [api, testId, valid],
  );
  const [state, reload] = useResource(load);
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>{state.kind === 'ready' ? state.data.test.name : 'Test'}</h2>
      {state.kind === 'loading' && <p role="status">Loading...</p>}
      {state.kind === 'error' && (
        <p role="alert" className={ui.alert}>
          {errorText(state.code)}
        </p>
      )}
      {state.kind === 'ready' && api !== null && (
        <EditorBody
          // A new key per loaded version resets the form after a publish.
          key={`${state.data.version.id}-${state.data.version.status}`}
          api={api}
          detail={state.data}
          onPublished={reload}
        />
      )}
    </section>
  );
}

/** Route `/tests/new`: names the test, creates the draft (cutoff 40) and opens it. */
export function NewTestRoute() {
  const api = useApi();
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
    </section>
  );
}
