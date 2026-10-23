// `/bank/ai-drafts` (specs/m1-test-authoring.md §4.4, §6.4, M1-8; AiDraftRequest, AiDraftJobView). Staff ask for
// drafts of one format, skill and difficulty on a topic; the api scrubs the topic and queues the job. Drafts arrive
// `in_review` and wait for a person: they are marked "AI draft — needs approval". Nothing about the model, its
// checks or any likeness score is shown; the job shows its status and how many drafts it made.
import type { AiDraftJobView, ItemFormat } from '@trace/shared/contracts/m1';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { createAiDraftJob, getAiDraftJob } from '../api/endpoints';
import { useApi } from '../api/runtime';
import type { ApiClient } from '../api/client';
import { CardPoller, usePoller } from '../common/poller';
import ui from '../common/Ui.module.css';
import { EMPTY_AI_FORM, toAiRequest, type AiDraftForm } from './ai-draft-form';
import { errorAt, type FieldError } from './item-form';
import {
  AI_DRAFT_BADGE,
  AI_ERROR_TEXT,
  FORMAT_LABEL,
  JOB_STATUS_LABEL,
  JOB_STILL_RUNNING,
  SKILL_SUGGESTIONS,
  bankErrorText,
  difficultyText,
} from './labels';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORMATS: readonly ItemFormat[] = ['mcq', 'written'];

export function AiDraftFormView({
  form,
  errors,
  busy,
  failure,
  onChange,
  onSubmit,
}: {
  form: AiDraftForm;
  errors: readonly FieldError[];
  busy: boolean;
  failure: string | null;
  onChange(next: AiDraftForm): void;
  onSubmit(): void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };
  const problem = (path: string) => {
    const message = errorAt(errors, path);
    return message === undefined ? null : (
      <span role="alert" className={ui.alert}>
        {message}
      </span>
    );
  };
  return (
    <form className={ui.form} onSubmit={submit} aria-label="Request drafts">
      <fieldset className={ui.fieldset}>
        <legend>Format</legend>
        <div className={ui.row}>
          {FORMATS.map((f) => (
            <label key={f} className={ui.choice}>
              <input
                type="radio"
                name="ai-format"
                checked={form.format === f}
                onChange={() => {
                  onChange({ ...form, format: f });
                }}
              />
              <span>{FORMAT_LABEL[f]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className={ui.field}>
        <span className={ui.label}>Skill</span>
        <input
          className={ui.input}
          type="text"
          list="ai-skill-suggestions"
          value={form.skillKey}
          onChange={(e) => {
            onChange({ ...form, skillKey: e.target.value });
          }}
        />
        <datalist id="ai-skill-suggestions">
          {SKILL_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {problem('skillKey')}
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
            onChange({ ...form, difficulty: e.target.value });
          }}
        />
        {problem('difficulty')}
      </label>
      <label className={ui.field}>
        <span className={ui.label}>Number of drafts</span>
        <input
          className={ui.input}
          type="text"
          inputMode="numeric"
          value={form.count}
          onChange={(e) => {
            onChange({ ...form, count: e.target.value });
          }}
        />
        {problem('count')}
      </label>
      <label className={ui.field}>
        <span className={ui.label}>Topic</span>
        <textarea
          className={ui.textarea}
          maxLength={500}
          value={form.topic}
          onChange={(e) => {
            onChange({ ...form, topic: e.target.value });
          }}
        />
        <span className={ui.note}>
          Describe the topic in plain words. Emails, phone numbers and links are removed from the
          topic before it is used.
        </span>
        {problem('topic')}
      </label>
      {failure !== null && (
        <p role="alert" className={ui.alert}>
          {bankErrorText(failure)}
        </p>
      )}
      <div className={ui.row}>
        <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={busy}>
          Request drafts
        </button>
      </div>
    </form>
  );
}

/** One job: its status, how many drafts it made and, when it failed, why (fixed words). */
export function AiJobView({ job }: { job: AiDraftJobView }) {
  return (
    <section className={ui.panel} aria-label="Draft job">
      <h3 className={ui.subtitle}>{`Draft job: ${JOB_STATUS_LABEL[job.status]}`}</h3>
      <p>{`${String(job.draftsCreated)} of ${String(job.count)} drafts created`}</p>
      <p className={ui.note}>
        {`${FORMAT_LABEL[job.format]} · Skill ${job.skillKey} · Difficulty ${difficultyText(job.difficulty)}`}
      </p>
      {job.status === 'failed' && (
        <p role="alert" className={ui.alert}>
          {job.errorCode === undefined
            ? 'Drafting did not finish. Try again.'
            : AI_ERROR_TEXT[job.errorCode]}
        </p>
      )}
      {job.status === 'completed' && job.draftsCreated > 0 && (
        <p>
          {`Drafts show “${AI_DRAFT_BADGE}” until a person approves them. `}
          <Link to="/bank/approvals">Open the approval queue</Link>
        </p>
      )}
      {job.status === 'completed' && job.draftsCreated === 0 && (
        <p className={ui.note}>No drafts were created.</p>
      )}
    </section>
  );
}

const isFinal = (job: AiDraftJobView): boolean =>
  job.status === 'completed' || job.status === 'failed';
/** The poll limit is our own code: a failure no retry changes, or a job that outlasted the polling. */
const POLL_LIMIT = 'poll_limit';
/** At 3 s then 15 s (common/poller.ts) this is about ten minutes; a longer job is read again on refresh. */
const MAX_POLLS = 60;
const TERMINAL_CODES: ReadonlySet<string> = new Set([
  'not_found',
  'unauthorized',
  'bad_request',
  'forbidden',
  'aal2_required',
  'invalid_response',
  POLL_LIMIT,
]);
const isTerminal = (code: string): boolean => TERMINAL_CODES.has(code);

function JobStatus({ api, jobId }: { api: ApiClient; jobId: string }) {
  const { poller, seen } = useMemo(() => {
    const last: { job: AiDraftJobView | null; polls: number } = { job: null, polls: 0 };
    const card = new CardPoller<AiDraftJobView>({
      fetchCard: async () => {
        if (last.polls >= MAX_POLLS) return { ok: false as const, code: POLL_LIMIT };
        last.polls += 1;
        const result = await getAiDraftJob(api, jobId);
        if (result.ok) last.job = result.data;
        return result;
      },
      isFinal,
      isTerminal,
    });
    return { poller: card, seen: last };
  }, [api, jobId]);
  useEffect(() => {
    poller.start();
    return () => {
      poller.stop();
    };
  }, [poller]);
  const snapshot = usePoller(poller);
  const state = snapshot.state;
  if (state.kind === 'loading') return <p role="status">Loading...</p>;
  if (state.kind === 'terminal' && state.code === POLL_LIMIT) {
    return (
      <>
        {seen.job !== null && <AiJobView job={seen.job} />}
        <p role="status">{JOB_STILL_RUNNING}</p>
      </>
    );
  }
  if (state.kind === 'terminal') {
    return (
      <p role="alert" className={ui.alert}>
        {bankErrorText(state.code)}
      </p>
    );
  }
  if (state.kind === 'unavailable') {
    return <p role="status">The job status could not be read. Trying again.</p>;
  }
  return <AiJobView job={state.value} />;
}

export function AiDraftsRoute() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState<AiDraftForm>(EMPTY_AI_FORM);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const requested = params.get('job');
  const jobId = requested !== null && UUID.test(requested) ? requested : null;

  const submit = () => {
    const built = toAiRequest(form);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors([]);
    if (api === null) {
      setFailure('unauthorized');
      return;
    }
    setBusy(true);
    setFailure(null);
    void createAiDraftJob(api, built.request).then((result) => {
      setBusy(false);
      if (result.ok) setParams({ job: result.data.id }, { replace: true });
      else setFailure(result.code);
    });
  };

  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>AI drafts</h2>
      <p className={ui.note}>
        Drafts are written by an AI service and wait in the approval queue. Nothing reaches a
        candidate before a person approves it.
      </p>
      <AiDraftFormView
        form={form}
        errors={errors}
        busy={busy}
        failure={failure}
        onChange={setForm}
        onSubmit={submit}
      />
      {jobId !== null && api !== null && <JobStatus key={jobId} api={api} jobId={jobId} />}
    </section>
  );
}

export default AiDraftsRoute;
