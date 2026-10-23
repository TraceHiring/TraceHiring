// Create a test from a role template (specs/m1-test-authoring.md §6.1, M1-16, E18, R5-15, R5-54 a). The component the
// `tests/new` wizard's first step shows ("pick a template") and, until the wizard mounts it, the stand-alone route
// `tests/new/template`; the export names are the A5-0 placeholder's. It lists templates in cursor pages, creates the
// draft with `POST …/tests/from-template`, and shows the blueprint sections the draft left out because their format
// (typing, voice) cannot be served yet (the M1-16 note). D1's own load and save paths are not touched (R5-53 b).
import type {
  CreateTestFromTemplateRequest,
  CreateTestFromTemplateResponse,
  RoleTemplateSummary,
} from '@trace/shared/contracts/m1';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { createTestFromTemplate, listRoleTemplates } from '../api/endpoints';
import { useApi } from '../api/runtime';
import { errorText } from '../common/messages';
import ui from '../common/Ui.module.css';
import { PRESET_INFO } from '../settings/integrity-model';

const FORMAT_TEXT = { typing: 'typing', voice: 'voice' } as const;
const templateId = (t: Pick<RoleTemplateSummary, 'templateKey' | 'version'>): string =>
  `${t.templateKey}:${t.version}`;

export interface FromTemplateViewProps {
  status: 'loading' | 'ready' | 'error';
  templates: readonly RoleTemplateSummary[];
  hasMore: boolean;
  loadingMore: boolean;
  /** `templateKey:version` of the chosen template. */
  selected: string | null;
  jobTitle: string;
  jdText: string;
  busy: boolean;
  /** An api failure code, shown as fixed text. */
  error: string | null;
  created: CreateTestFromTemplateResponse | null;
  onSelect(id: string): void;
  onJobTitle(value: string): void;
  onJdText(value: string): void;
  onMore(): void;
  onCreate(): void;
}

function CreatedView({ created }: { created: CreateTestFromTemplateResponse }) {
  return (
    <div className={ui.stack}>
      <p role="status">{`Draft created: ${created.draft.test.name}.`}</p>
      {created.skippedSections.length > 0 && (
        <div className={ui.panel}>
          <h3 className={ui.subtitle}>Not in this draft yet</h3>
          <p>These sections are not available yet and were left out of this draft.</p>
          <ul>
            {created.skippedSections.map((s) => (
              <li
                key={`${s.format}:${s.title}`}
              >{`${s.title} (${FORMAT_TEXT[s.format]} section)`}</li>
            ))}
          </ul>
        </div>
      )}
      <p>
        <Link to={`/tests/${created.draft.test.id}`}>Open the draft</Link>
      </p>
    </div>
  );
}

export function FromTemplateView(props: FromTemplateViewProps) {
  const ready = props.selected !== null && props.jobTitle.trim() !== '';
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>New test from a template</h2>
      {props.status === 'loading' && <p role="status">Loading...</p>}
      {props.status === 'error' && (
        <p role="alert" className={ui.alert}>
          {errorText(props.error ?? '')}
        </p>
      )}
      {props.status === 'ready' && props.created !== null && (
        <CreatedView created={props.created} />
      )}
      {props.status === 'ready' && props.created === null && (
        <form
          className={ui.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !props.busy) props.onCreate();
          }}
        >
          <label className={ui.field}>
            <span className={ui.label}>Job title</span>
            <input
              className={ui.input}
              type="text"
              maxLength={200}
              value={props.jobTitle}
              onChange={(e) => {
                props.onJobTitle(e.target.value);
              }}
            />
          </label>
          <fieldset className={ui.fieldset}>
            <legend className={ui.label}>Template</legend>
            {props.templates.length === 0 && <p className={ui.note}>No templates yet.</p>}
            {props.templates.map((t) => (
              <label key={templateId(t)} className={ui.choice}>
                <input
                  type="radio"
                  name="template"
                  checked={props.selected === templateId(t)}
                  onChange={() => {
                    props.onSelect(templateId(t));
                  }}
                />
                <span>{`${t.name} (version ${t.version}, ${PRESET_INFO[t.presetKey].label})`}</span>
              </label>
            ))}
            {props.hasMore && (
              <button
                type="button"
                className={ui.button}
                disabled={props.loadingMore}
                onClick={props.onMore}
              >
                Load more templates
              </button>
            )}
          </fieldset>
          <label className={ui.field}>
            <span className={ui.label}>Job description (optional)</span>
            <textarea
              className={ui.textarea}
              maxLength={50000}
              value={props.jdText}
              onChange={(e) => {
                props.onJdText(e.target.value);
              }}
            />
          </label>
          <p className={ui.note}>
            The job description is read once to shape the draft and is not stored.
          </p>
          <button
            type="submit"
            className={`${ui.button} ${ui.primary}`}
            disabled={!ready || props.busy}
          >
            Create draft
          </button>
          {props.error !== null && (
            <p role="alert" className={ui.alert}>
              {errorText(props.error)}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

/** Route `tests/new/template`, and the template choice of the `tests/new` wizard's first step. */
export function FromTemplateRoute() {
  const api = useApi();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [templates, setTemplates] = useState<RoleTemplateSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState('');
  const [jdText, setJdText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateTestFromTemplateResponse | null>(null);

  useEffect(() => {
    if (api === null) return;
    let live = true;
    void listRoleTemplates(api).then((result) => {
      if (!live) return;
      if (result.ok) {
        setTemplates(result.data.templates);
        setNextCursor(result.data.nextCursor);
        setStatus('ready');
      } else {
        setError(result.code);
        setStatus('error');
      }
    });
    return () => {
      live = false;
    };
  }, [api]);

  const more = async () => {
    if (api === null || nextCursor === null) return;
    setLoadingMore(true);
    const result = await listRoleTemplates(api, { cursor: nextCursor });
    setLoadingMore(false);
    if (result.ok) {
      setTemplates((current) => [...current, ...result.data.templates]);
      setNextCursor(result.data.nextCursor);
    } else {
      setError(result.code);
    }
  };

  const create = async () => {
    const chosen = templates.find((t) => templateId(t) === selected);
    if (api === null || chosen === undefined) return;
    const body: CreateTestFromTemplateRequest = {
      jobTitle: jobTitle.trim(),
      templateKey: chosen.templateKey,
      templateVersion: chosen.version,
      ...(jdText.trim() === '' ? {} : { jdText: jdText.trim() }),
    };
    setBusy(true);
    setError(null);
    const result = await createTestFromTemplate(api, body);
    setBusy(false);
    if (result.ok) setCreated(result.data);
    else setError(result.code);
  };

  return (
    <FromTemplateView
      status={status}
      templates={templates}
      hasMore={nextCursor !== null}
      loadingMore={loadingMore}
      selected={selected}
      jobTitle={jobTitle}
      jdText={jdText}
      busy={busy}
      error={error}
      created={created}
      onSelect={setSelected}
      onJobTitle={setJobTitle}
      onJdText={setJdText}
      onMore={() => void more()}
      onCreate={() => void create()}
    />
  );
}

export default FromTemplateRoute;
