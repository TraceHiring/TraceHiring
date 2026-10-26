// Create a test from a role template (specs/m1-test-authoring.md §6.1, M1-16, M1-17, E18, E19, R5-15, R5-54 a,
// R5-55 b). This is the template choice of step 1 of the `tests/new` wizard: D1's NewTestRoute mounts it embedded,
// next to D1's own start, so the D1 slice keeps one flow. There is no `tests/new/template` route (R5-55 b); the export
// names are the A5-0 placeholder's; the stand-alone render (`FromTemplateRoute` without `embedded`) has no route and
// stays for the guards that render it (m1-guards: its heading). It lists templates in cursor pages,
// proposes one from a pasted job description (`POST …/blueprints/propose`: the api's deterministic keyword match; a
// match of at least 0.15 is preselected, else "Pick a template"), creates the draft with `POST …/tests/from-template`,
// and shows the blueprint sections the draft left out because their format (typing, voice) cannot be served yet (the
// M1-16 note). The job description text is never stored (M1-17); D1's own load and save paths are not touched (R5-53 b).
import type {
  BlueprintProposal,
  CreateTestFromTemplateRequest,
  CreateTestFromTemplateResponse,
  RoleTemplateSummary,
} from '@trace/shared/contracts/m1';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { createTestFromTemplate, listRoleTemplates, proposeBlueprint } from '../api/endpoints';
import { useApi } from '../api/runtime';
import { errorText } from '../common/messages';
import ui from '../common/Ui.module.css';
import { PRESET_INFO } from '../settings/integrity-model';

const FORMAT_TEXT = {
  mcq: 'multiple-choice',
  written: 'written',
  typing: 'typing',
  voice: 'voice',
} as const;
const templateId = (t: Pick<RoleTemplateSummary, 'templateKey' | 'version'>): string =>
  `${t.templateKey}:${t.version}`;

/** §6.1: the best template is proposed only when it matches at least 0.15 of its keywords (150 permille). */
export const PROPOSAL_MIN_PERMILLE = 150;

/** What the job description proposed, as the view shows it. */
export type ProposalState =
  | { kind: 'none' }
  | { kind: 'asking' }
  | {
      kind: 'matched';
      name: string;
      sections: readonly { title: string; available: boolean }[];
    }
  | { kind: 'no_match' };

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
  proposal: ProposalState;
  /** Inside the `tests/new` wizard's step 1, under its page heading (a section heading, not a page heading). */
  embedded?: boolean;
  onSelect(id: string): void;
  onJobTitle(value: string): void;
  onJdText(value: string): void;
  onMore(): void;
  onPropose(): void;
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

function ProposalNote({ proposal }: { proposal: ProposalState }) {
  if (proposal.kind === 'none') return null;
  if (proposal.kind === 'asking') return <p role="status">Looking for a matching template...</p>;
  if (proposal.kind === 'no_match') {
    return (
      <p role="status">No template matches this job description closely enough. Pick a template.</p>
    );
  }
  return (
    <div className={ui.panel} role="status">
      <p>{`Suggested from the job description: ${proposal.name}.`}</p>
      <ul>
        {proposal.sections.map((s, i) => (
          <li key={i}>{s.available ? s.title : `${s.title} (not available yet)`}</li>
        ))}
      </ul>
    </div>
  );
}

export function FromTemplateView(props: FromTemplateViewProps) {
  const ready = props.selected !== null && props.jobTitle.trim() !== '';
  const asking = props.proposal.kind === 'asking';
  return (
    <section className={ui.stack} data-region="from-template">
      {props.embedded === true ? (
        <h3 className={ui.subtitle}>Or start from a role template</h3>
      ) : (
        <h2 className={ui.title}>New test from a template</h2>
      )}
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
            The job description is used only to suggest a template, by matching template keywords.
            Its text is not stored.
          </p>
          <div className={ui.row}>
            <button
              type="button"
              className={ui.button}
              disabled={props.jdText.trim() === '' || asking || props.busy}
              onClick={props.onPropose}
            >
              Suggest a template
            </button>
          </div>
          <ProposalNote proposal={props.proposal} />
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
          <button
            type="submit"
            className={`${ui.button} ${ui.primary}`}
            disabled={!ready || props.busy}
          >
            Create draft from template
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

/** The template a proposal names, by key and version (it may sit on a page not loaded yet). */
interface ChosenTemplate {
  templateKey: string;
  version: number;
  name: string;
}

/** The template choice of the `tests/new` wizard's step 1 (`embedded`), or its stand-alone render. */
export function FromTemplateRoute({ embedded = false }: { embedded?: boolean } = {}) {
  const api = useApi();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [templates, setTemplates] = useState<RoleTemplateSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [proposed, setProposed] = useState<ChosenTemplate | null>(null);
  const [proposal, setProposal] = useState<ProposalState>({ kind: 'none' });
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

  const nameOf = (p: BlueprintProposal): string =>
    templates.find((t) => templateId(t) === templateId(p))?.name ?? p.templateKey;

  const propose = async () => {
    const text = jdText.trim();
    if (api === null || text === '') return;
    setProposal({ kind: 'asking' });
    setError(null);
    const result = await proposeBlueprint(api, { jdText: text });
    if (!result.ok) {
      setProposal({ kind: 'none' });
      setError(result.code);
      return;
    }
    const p = result.data.proposal;
    if (p === null || p.matchPermille < PROPOSAL_MIN_PERMILLE) {
      setProposal({ kind: 'no_match' });
      return;
    }
    setSelected(templateId(p));
    setProposed({ templateKey: p.templateKey, version: p.version, name: nameOf(p) });
    setProposal({
      kind: 'matched',
      name: nameOf(p),
      sections: p.sections.map((s) => ({ title: s.title, available: s.available })),
    });
  };

  const create = async () => {
    const listed = templates.find((t) => templateId(t) === selected);
    const chosen: ChosenTemplate | undefined =
      listed ?? (proposed !== null && templateId(proposed) === selected ? proposed : undefined);
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
      proposal={proposal}
      embedded={embedded}
      onSelect={setSelected}
      onJobTitle={setJobTitle}
      onJdText={(value) => {
        setJdText(value);
        // A changed description has not been matched yet.
        if (proposal.kind !== 'asking') setProposal({ kind: 'none' });
      }}
      onMore={() => void more()}
      onPropose={() => void propose()}
      onCreate={() => void create()}
    />
  );
}

export default FromTemplateRoute;
