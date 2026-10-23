// The import screen's views (spec §6.9). Pure: every state comes in as props, so each one renders from synthetic data.
// Every value from a file is drawn only as React text, and the errors table shows a row, a column and a reason in
// words, never a cell value. The heading stays in every state.
import { useState } from 'react';
import { Link } from 'react-router';
import ui from '../../common/Ui.module.css';
import type { RunState } from './run';
import type { RowIssue } from './rows';
import type { TemplateKind } from './template-files';
import { failureText, fieldLabel, rowErrorText } from './texts';

/** The table shows this many problems a page; Previous and Next reach every one of them (AT-M1-11). */
export const ERRORS_PER_PAGE = 100;

export type Screen =
  | {
      kind: 'choose';
      fileName: string | null;
      zipName: string | null;
      checking: boolean;
      failure: string | null;
    }
  | {
      kind: 'checked';
      sourceKind: 'xlsx' | 'docx';
      fileName: string;
      rowsRead: number;
      rowsReady: number;
      imagesInFile: number;
      issues: RowIssue[];
    }
  | {
      kind: 'run';
      sourceKind: 'xlsx' | 'docx';
      fileName: string;
      rowsRead: number;
      state: RunState;
    };

export interface ImportHandlers {
  onFile(file: File | null): void;
  onZip(file: File | null): void;
  onCheck(): void;
  onStart(): void;
  onChooseAnother(): void;
  onTryAgain(): void;
  onFinish(): void;
  onCancel(): void;
  onDownloadErrors(): void;
  onDownloadTemplate(kind: TemplateKind): void;
}

const distinctRows = (issues: readonly RowIssue[]): number =>
  new Set(issues.map((issue) => issue.rowNo)).size;

export function ErrorsTable({ issues }: { issues: readonly RowIssue[] }) {
  const [requested, setPage] = useState(0);
  if (issues.length === 0) return null;
  const pages = Math.ceil(issues.length / ERRORS_PER_PAGE);
  // The list can get shorter while a page past its end is open (a retry fixed rows): stay on the last page there is.
  const page = Math.min(requested, pages - 1);
  const first = page * ERRORS_PER_PAGE;
  const shown = issues.slice(first, first + ERRORS_PER_PAGE);
  return (
    <div className={ui.stack}>
      <table className={ui.table}>
        <thead>
          <tr>
            <th scope="col">Row</th>
            <th scope="col">Column</th>
            <th scope="col">Problem</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((issue) => (
            <tr key={`${issue.rowNo}:${issue.field}:${issue.code}`}>
              <td>{issue.rowNo}</td>
              <td>{fieldLabel(issue.field)}</td>
              <td>{rowErrorText(issue.code)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pages > 1 && (
        <div className={ui.row}>
          <button
            type="button"
            className={ui.button}
            disabled={page === 0}
            onClick={() => {
              setPage(page - 1);
            }}
          >
            Previous
          </button>
          <p className={ui.note}>
            {`Showing ${first + 1}–${first + shown.length} of ${issues.length} problems`}
          </p>
          <button
            type="button"
            className={ui.button}
            disabled={page >= pages - 1}
            onClick={() => {
              setPage(page + 1);
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

const DOCX_NOTE = 'In a Word file, row 2 is the first Heading 2 item.';

function Choose({
  screen,
  handlers,
}: {
  screen: Extract<Screen, { kind: 'choose' }>;
  handlers: ImportHandlers;
}) {
  return (
    <div className={ui.stack}>
      <p className={ui.note}>
        Import questions from a file made with the Trace template (trace-items-v1). The file is read
        in your browser and is not uploaded; only the questions and their images are sent.
      </p>
      <div className={ui.row}>
        <button
          type="button"
          className={ui.button}
          onClick={() => {
            handlers.onDownloadTemplate('xlsx');
          }}
        >
          Download the template (.xlsx)
        </button>
        <button
          type="button"
          className={ui.button}
          onClick={() => {
            handlers.onDownloadTemplate('docx');
          }}
        >
          Download the template (.docx)
        </button>
      </div>
      <div className={ui.form}>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="import-file">
            Items file (.xlsx or .docx)
          </label>
          <input
            id="import-file"
            className={ui.input}
            type="file"
            accept=".xlsx,.docx"
            disabled={screen.checking}
            onChange={(event) => {
              handlers.onFile(event.target.files?.[0] ?? null);
            }}
          />
          {screen.fileName !== null && <p className={ui.note}>Selected: {screen.fileName}</p>}
        </div>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="import-zip">
            Images zip (optional, for .xlsx)
          </label>
          <input
            id="import-zip"
            className={ui.input}
            type="file"
            accept=".zip"
            disabled={screen.checking}
            onChange={(event) => {
              handlers.onZip(event.target.files?.[0] ?? null);
            }}
          />
          {screen.zipName !== null && <p className={ui.note}>Selected: {screen.zipName}</p>}
        </div>
        <div className={ui.row}>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={screen.fileName === null || screen.checking}
            onClick={handlers.onCheck}
          >
            Check file
          </button>
        </div>
      </div>
      {screen.checking && (
        <p className={ui.note} role="status">
          Reading the file…
        </p>
      )}
      {screen.failure !== null && (
        <p className={ui.alert} role="alert">
          {failureText(screen.failure)}
        </p>
      )}
    </div>
  );
}

function Checked({
  screen,
  handlers,
}: {
  screen: Extract<Screen, { kind: 'checked' }>;
  handlers: ImportHandlers;
}) {
  return (
    <div className={ui.stack}>
      <p className={ui.note}>File: {screen.fileName}</p>
      <ul className={ui.items}>
        <li>Rows in the file: {screen.rowsRead}</li>
        <li>Ready to import: {screen.rowsReady}</li>
        <li>Rows with problems: {distinctRows(screen.issues)}</li>
        <li>Images found: {screen.imagesInFile}</li>
      </ul>
      {screen.rowsReady === 0 && (
        <p className={ui.alert} role="alert">
          {failureText('nothing_to_import')}
        </p>
      )}
      {screen.issues.length > 0 && (
        <>
          <h3 className={ui.subtitle}>Rows with problems</h3>
          {screen.sourceKind === 'docx' && <p className={ui.note}>{DOCX_NOTE}</p>}
          <ErrorsTable issues={screen.issues} />
          <div className={ui.row}>
            <button type="button" className={ui.button} onClick={handlers.onDownloadErrors}>
              Download the error list (CSV)
            </button>
          </div>
        </>
      )}
      <div className={ui.row}>
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={screen.rowsReady === 0}
          onClick={handlers.onStart}
        >
          Start import
        </button>
        <button type="button" className={ui.button} onClick={handlers.onChooseAnother}>
          Choose another file
        </button>
      </div>
    </div>
  );
}

function RunView({
  screen,
  handlers,
}: {
  screen: Extract<Screen, { kind: 'run' }>;
  handlers: ImportHandlers;
}) {
  const { state } = screen;
  const phase = state.phase;
  const problems = distinctRows(state.issues);
  const ended = phase === 'completed' || phase === 'cancelled' || phase === 'failed';
  const another = (
    <button type="button" className={ui.button} onClick={handlers.onChooseAnother}>
      Import another file
    </button>
  );
  const download = state.issues.length > 0 && (
    <button type="button" className={ui.button} onClick={handlers.onDownloadErrors}>
      Download the error list (CSV)
    </button>
  );
  return (
    <div className={ui.stack}>
      <p className={ui.note}>File: {screen.fileName}</p>

      {phase === 'running' && (
        <div className={ui.stack} role="status">
          {state.stage === 'job' && <p>Creating the import…</p>}
          {state.imagesTotal > 0 && (
            <p>
              Images: {state.imagesDone} of {state.imagesTotal}
            </p>
          )}
          <p>
            Rows: {state.rowsSent} of {state.rowsTotal}
          </p>
        </div>
      )}
      {(phase === 'completing' || phase === 'cancelling') && (
        <p role="status">{phase === 'completing' ? 'Finishing the import…' : 'Cancelling…'}</p>
      )}
      {phase === 'ready' && (
        <div className={ui.stack}>
          <p role="status">All rows were sent.</p>
          <ul className={ui.items}>
            <li>Rows accepted: {state.accepted}</li>
            <li>Rows with problems: {problems}</li>
          </ul>
        </div>
      )}
      {phase === 'completed' && (
        <div className={ui.stack}>
          <p role="status">Import finished.</p>
          <ul className={ui.items}>
            <li>Questions imported: {state.job?.rowsOk ?? state.accepted}</li>
            <li>Rows with problems: {problems}</li>
          </ul>
          <p>
            <Link to="/bank">Go to the item bank</Link>
          </p>
        </div>
      )}
      {phase === 'cancelled' && (
        <div className={ui.stack}>
          <p role="status">Import cancelled. Rows already imported stay in your bank.</p>
          {state.job !== null && <p>Questions imported: {state.job.rowsOk}</p>}
          <p>
            <Link to="/bank">Go to the item bank</Link>
          </p>
        </div>
      )}
      {(phase === 'stopped' ||
        phase === 'failed' ||
        (phase === 'ready' && state.failure !== null)) &&
        state.failure !== null && (
          <div className={ui.stack}>
            {phase === 'failed' && <p>The import failed.</p>}
            <p className={ui.alert} role="alert">
              {failureText(state.failure)}
            </p>
            {phase === 'stopped' && <p className={ui.note}>Rows already sent are kept.</p>}
          </div>
        )}

      {state.issues.length > 0 && (
        <div className={ui.stack}>
          <h3 className={ui.subtitle}>Rows with problems</h3>
          {screen.sourceKind === 'docx' && <p className={ui.note}>{DOCX_NOTE}</p>}
          <ErrorsTable issues={state.issues} />
        </div>
      )}

      <div className={ui.row}>
        {phase === 'ready' && state.rowsSent > 0 && (
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            onClick={handlers.onFinish}
          >
            Finish import
          </button>
        )}
        {phase === 'stopped' && (
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            onClick={handlers.onTryAgain}
          >
            Try again
          </button>
        )}
        {(phase === 'running' || phase === 'ready' || phase === 'stopped') && (
          <button type="button" className={ui.button} onClick={handlers.onCancel}>
            Cancel import
          </button>
        )}
        {(phase === 'ready' || ended) && download}
        {ended && another}
      </div>
    </div>
  );
}

export function ImportView({ screen, handlers }: { screen: Screen; handlers: ImportHandlers }) {
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>Import items</h2>
      {screen.kind === 'choose' && <Choose screen={screen} handlers={handlers} />}
      {screen.kind === 'checked' && <Checked screen={screen} handlers={handlers} />}
      {screen.kind === 'run' && <RunView screen={screen} handlers={handlers} />}
    </section>
  );
}
