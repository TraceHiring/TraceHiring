// `/drives/new` (specs/m2-scheduling-invites.md §6.1, M2-8, M2-13, M2-17, M2-21): a drive for one published test version,
// open window or scheduled, with its window in IST, 0-4 reminders (default 24 hours and 1 hour), the self-reschedule
// switch, "Lab mode" (no description until the founder answers, M2-21) and an optional expected number of candidates.
// The form is checked against CreateDriveRequest before anything is sent; an api refusal is shown as fixed words.
import type { TestListResponse } from '@trace/shared/contracts/d1';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { createDrive, getTest, listTests } from '../api/endpoints';
import { useApi } from '../api/runtime';
import ui from '../common/Ui.module.css';
import {
  EMPTY_FORM,
  MAX_REMINDERS,
  UNIT_LABEL,
  buildDriveRequest,
  type DriveForm,
  type ReminderField,
  type ReminderUnit,
  type VersionLookup,
} from './drive-form';
import { driveErrorText } from './messages';
import { MODE_LABEL } from './texts';

type TestRow = TestListResponse['tests'][number];
export type TestsState =
  | { kind: 'loading' }
  | { kind: 'error'; code: string }
  | { kind: 'ready'; tests: readonly TestRow[] };

export interface NewDriveViewProps {
  tests: TestsState;
  form: DriveForm;
  lookup: VersionLookup;
  problems: readonly string[];
  /** An api failure code, shown as fixed text. */
  error: string | null;
  busy: boolean;
  onForm(patch: Partial<DriveForm>): void;
  onReminder(index: number, patch: Partial<ReminderField>): void;
  onAddReminder(): void;
  onRemoveReminder(index: number): void;
  onSubmit(): void;
}

const LATEST: Readonly<Record<TestRow['status'], string>> = {
  published: 'published',
  draft: 'latest version is a draft',
  retired: 'latest version is retired',
};

export function NewDriveView(props: NewDriveViewProps) {
  const { form, lookup } = props;
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>New drive</h2>
      <form
        className={ui.form}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!props.busy) props.onSubmit();
        }}
      >
        <label className={ui.field}>
          <span className={ui.label}>Drive name</span>
          <input
            className={ui.input}
            type="text"
            maxLength={200}
            autoComplete="off"
            value={form.name}
            onChange={(e) => {
              props.onForm({ name: e.target.value });
            }}
          />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Test</span>
          <select
            className={ui.select}
            value={form.testId}
            onChange={(e) => {
              props.onForm({ testId: e.target.value, versionId: '' });
            }}
          >
            <option value="">Choose a test</option>
            {props.tests.kind === 'ready' &&
              props.tests.tests.map((test) => (
                <option key={test.id} value={test.id}>
                  {`${test.name} (version ${String(test.versionNo)}, ${LATEST[test.status]})`}
                </option>
              ))}
          </select>
        </label>
        {props.tests.kind === 'error' && (
          <p role="alert" className={ui.alert}>
            {driveErrorText(props.tests.code)}
          </p>
        )}
        {lookup.kind === 'loading' && <p role="status">Finding the published version...</p>}
        {lookup.kind === 'published' && (
          <p className={ui.note}>{`Version ${String(lookup.versionNo)} (published)`}</p>
        )}
        {lookup.kind === 'manual' && (
          <label className={ui.field}>
            <span className={ui.label}>Published version id</span>
            <input
              className={`${ui.input} ${ui.mono}`}
              type="text"
              maxLength={36}
              autoComplete="off"
              value={form.versionId}
              onChange={(e) => {
                props.onForm({ versionId: e.target.value });
              }}
            />
          </label>
        )}
        <label className={ui.field}>
          <span className={ui.label}>Mode</span>
          <select
            className={ui.select}
            value={form.mode}
            onChange={(e) => {
              props.onForm({
                mode: e.target.value === 'open_window' ? 'open_window' : 'scheduled',
              });
            }}
          >
            <option value="scheduled">{MODE_LABEL.scheduled}</option>
            <option value="open_window">{MODE_LABEL.open_window}</option>
          </select>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Opens (IST)</span>
          <input
            className={ui.input}
            type="datetime-local"
            value={form.opens}
            onChange={(e) => {
              props.onForm({ opens: e.target.value });
            }}
          />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Deadline (IST)</span>
          <input
            className={ui.input}
            type="datetime-local"
            value={form.deadline}
            onChange={(e) => {
              props.onForm({ deadline: e.target.value });
            }}
          />
        </label>
        <fieldset className={ui.fieldset}>
          <legend className={ui.label}>Reminders (before the start, or before the deadline)</legend>
          {form.reminders.map((reminder, index) => (
            <div className={ui.row} key={index}>
              <label className={ui.field}>
                <span className={ui.label}>{`Reminder ${String(index + 1)}`}</span>
                <input
                  className={ui.input}
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="off"
                  value={reminder.value}
                  onChange={(e) => {
                    props.onReminder(index, { value: e.target.value });
                  }}
                />
              </label>
              <label className={ui.field}>
                <span className={ui.label}>{`Reminder ${String(index + 1)} unit`}</span>
                <select
                  className={ui.select}
                  value={reminder.unit}
                  onChange={(e) => {
                    const unit = e.target.value as ReminderUnit;
                    props.onReminder(index, { unit });
                  }}
                >
                  {(Object.keys(UNIT_LABEL) as ReminderUnit[]).map((unit) => (
                    <option key={unit} value={unit}>
                      {UNIT_LABEL[unit]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={ui.button}
                aria-label={`Remove reminder ${String(index + 1)}`}
                onClick={() => {
                  props.onRemoveReminder(index);
                }}
              >
                Remove
              </button>
            </div>
          ))}
          {form.reminders.length < MAX_REMINDERS && (
            <p>
              <button type="button" className={ui.button} onClick={props.onAddReminder}>
                Add reminder
              </button>
            </p>
          )}
        </fieldset>
        <label className={ui.field}>
          <span className={ui.label}>Allow candidates to reschedule once</span>
          <select
            className={ui.select}
            value={form.reschedule}
            onChange={(e) => {
              props.onForm({ reschedule: e.target.value === 'no' ? 'no' : 'yes' });
            }}
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Lab mode</span>
          <select
            className={ui.select}
            value={form.lab}
            onChange={(e) => {
              props.onForm({ lab: e.target.value === 'on' ? 'on' : 'off' });
            }}
          >
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Expected candidates (optional)</span>
          <input
            className={ui.input}
            type="text"
            inputMode="numeric"
            maxLength={6}
            autoComplete="off"
            value={form.expected}
            onChange={(e) => {
              props.onForm({ expected: e.target.value });
            }}
          />
        </label>
        {props.problems.length > 0 && (
          <div role="alert" className={ui.alert}>
            <p>Fix these first:</p>
            <ul>
              {props.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}
        {props.error !== null && (
          <p role="alert" className={ui.alert}>
            {driveErrorText(props.error)}
          </p>
        )}
        <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={props.busy}>
          Create drive
        </button>
      </form>
    </section>
  );
}

export function NewDriveRoute() {
  const api = useApi();
  const navigate = useNavigate();
  const [tests, setTests] = useState<TestsState>({ kind: 'loading' });
  const [form, setForm] = useState<DriveForm>(EMPTY_FORM);
  const [found, setFound] = useState<{ testId: string; lookup: VersionLookup } | null>(null);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (api === null) return;
    let live = true;
    void listTests(api).then((result) => {
      if (!live) return;
      setTests(
        result.ok
          ? { kind: 'ready', tests: result.data.tests }
          : { kind: 'error', code: result.code },
      );
    });
    return () => {
      live = false;
    };
  }, [api]);

  // The published version of the chosen test: found by itself when the latest version is published (D1/M1 calls),
  // otherwise typed by hand (Lead ask: a call that names the published version of a test with an open draft).
  const testId = form.testId;
  const chosen = tests.kind === 'ready' ? tests.tests.find((t) => t.id === testId) : undefined;
  const lookup: VersionLookup =
    chosen === undefined
      ? { kind: 'none' }
      : chosen.status !== 'published'
        ? { kind: 'manual' }
        : found?.testId === testId
          ? found.lookup
          : { kind: 'loading' };
  const needsLookup = chosen?.status === 'published';
  useEffect(() => {
    if (api === null || !needsLookup) return;
    let live = true;
    void getTest(api, testId).then((result) => {
      if (!live) return;
      setFound({
        testId,
        lookup:
          result.ok && result.data.version.status === 'published'
            ? {
                kind: 'published',
                versionId: result.data.version.id,
                versionNo: result.data.version.versionNo,
              }
            : { kind: 'manual' },
      });
    });
    return () => {
      live = false;
    };
  }, [api, testId, needsLookup]);

  const submit = async () => {
    const built = buildDriveRequest(form, lookup);
    setError(null);
    if (!built.ok) {
      setProblems(built.problems);
      return;
    }
    setProblems([]);
    if (api === null) return;
    setBusy(true);
    const result = await createDrive(api, built.request);
    setBusy(false);
    if (result.ok) void navigate(`/drives/${result.data.id}`);
    else setError(result.code);
  };

  return (
    <NewDriveView
      tests={tests}
      form={form}
      lookup={lookup}
      problems={problems}
      error={error}
      busy={busy}
      onForm={(patch) => {
        setForm((f) => ({ ...f, ...patch }));
      }}
      onReminder={(index, patch) => {
        setForm((f) => ({
          ...f,
          reminders: f.reminders.map((r, i) => (i === index ? { ...r, ...patch } : r)),
        }));
      }}
      onAddReminder={() => {
        setForm((f) =>
          f.reminders.length >= MAX_REMINDERS
            ? f
            : { ...f, reminders: [...f.reminders, { value: '', unit: 'hours' }] },
        );
      }}
      onRemoveReminder={(index) => {
        setForm((f) => ({ ...f, reminders: f.reminders.filter((_, i) => i !== index) }));
      }}
      onSubmit={() => void submit()}
    />
  );
}
