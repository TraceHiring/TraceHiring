// The invite upload screens (specs/m2-scheduling-invites.md §6.2, M2-6, M2-7, R2-12, R5-20, R5-59, AT-M2-32): choose a
// CSV (the columns are listed as text, there is no template to fetch), see the rows in the file, watch the batches go,
// then see who was invited, which rows were not (row number and reason in plain words, never the cell value) and the
// held phone-shared rows, each with its own action that frees exactly that row. Pure view: the route owns the state.
import { useState } from 'react';
import { Link } from 'react-router';
import ui from '../../common/Ui.module.css';
import { MAX_FILE_BYTES, MAX_ROWS } from './limits';
import type { RunState } from './run';
import { COLUMN_HELP, FILE_REFUSAL_TEXT, ROW_REASON_TEXT, failureText } from './texts';
import type { FileRefusal, RowIssue } from './types';

export const REFUSED_PER_PAGE = 100;

export type Screen =
  | { kind: 'choose'; refusal: FileRefusal | null; reading: boolean }
  | { kind: 'checked'; rowsInFile: number; sendable: number; issues: readonly RowIssue[] }
  | { kind: 'run'; run: RunState };

export interface UploadHandlers {
  onFile(file: File | null): void;
  onStart(): void;
  onChooseAnother(): void;
  onCancel(): void;
  onRetry(): void;
  /** Re-sends the one held row with this number (one button per held row, R5-59). */
  onMarkDifferent(rowNo: number): void;
  onFinish(): void;
}

/** The rows not invited, one page of up to 100 at a time: row number, then the reason in plain words. */
export function RefusedTable({ issues }: { issues: readonly RowIssue[] }) {
  const [page, setPage] = useState(0);
  if (issues.length === 0) return null;
  const pages = Math.ceil(issues.length / REFUSED_PER_PAGE);
  const at = Math.min(page, pages - 1);
  const from = at * REFUSED_PER_PAGE;
  const shown = issues.slice(from, from + REFUSED_PER_PAGE);
  return (
    <div className={ui.stack}>
      <table className={ui.table}>
        <thead>
          <tr>
            <th scope="col">Row</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((issue) => (
            <tr key={`${String(issue.rowNo)}-${issue.reason}`}>
              <th scope="row">{issue.rowNo}</th>
              <td>{ROW_REASON_TEXT[issue.reason]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pages > 1 && (
        <div className={ui.row}>
          <p className={ui.note}>
            {`Showing rows ${String(from + 1)} to ${String(from + shown.length)} of ${String(issues.length)}`}
          </p>
          <button
            type="button"
            className={ui.button}
            disabled={at === 0}
            onClick={() => {
              setPage(at - 1);
            }}
          >
            Previous rows
          </button>
          <button
            type="button"
            className={ui.button}
            disabled={at >= pages - 1}
            onClick={() => {
              setPage(at + 1);
            }}
          >
            Next rows
          </button>
        </div>
      )}
    </div>
  );
}

/** Held rows (phone_shared), each with its own button that sends exactly that row again (R2-12, M2-5, R5-59). */
export function HeldTable({
  rowNos,
  busy,
  onMarkDifferent,
}: {
  rowNos: readonly number[];
  busy: boolean;
  onMarkDifferent(rowNo: number): void;
}) {
  if (rowNos.length === 0) return null;
  return (
    <div className={ui.stack}>
      <h4 className={ui.subtitle}>Rows on hold</h4>
      <p className={ui.note}>
        Use a row’s button only when that row is a different person from the one already invited
        with the same phone number. Only that row is sent again; nothing else changes.
      </p>
      <table className={ui.table}>
        <thead>
          <tr>
            <th scope="col">Row</th>
            <th scope="col">Reason</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {rowNos.map((rowNo) => (
            <tr key={rowNo}>
              <th scope="row">{rowNo}</th>
              <td>{ROW_REASON_TEXT.phone_shared}</td>
              <td>
                <button
                  type="button"
                  className={ui.button}
                  aria-label={`Mark as different people, row ${String(rowNo)}`}
                  disabled={busy}
                  onClick={() => {
                    onMarkDifferent(rowNo);
                  }}
                >
                  Mark as different people
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpectedColumns() {
  return (
    <div className={ui.stack}>
      <h3 className={ui.subtitle}>What the file needs</h3>
      <p className={ui.note}>
        {`A CSV file with these columns in its first row, in any order, up to ${MAX_ROWS.toLocaleString('en-IN')} rows and ${String(MAX_FILE_BYTES / (1024 * 1024))} MB. The column names are not case sensitive.`}
      </p>
      <table className={ui.table}>
        <thead>
          <tr>
            <th scope="col">Column</th>
            <th scope="col">Needed</th>
            <th scope="col">What goes in it</th>
          </tr>
        </thead>
        <tbody>
          {COLUMN_HELP.map((column) => (
            <tr key={column.name}>
              <th scope="row">{column.name}</th>
              <td>{column.need}</td>
              <td>{column.help}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Choose({
  screen,
  handlers,
}: {
  screen: Extract<Screen, { kind: 'choose' }>;
  handlers: UploadHandlers;
}) {
  return (
    <div className={ui.stack}>
      <p className={ui.note}>
        The file is read in this browser and is not uploaded as a file; only the rows are sent.
      </p>
      <ExpectedColumns />
      <div className={ui.form}>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="invite-file">
            Invite file (CSV)
          </label>
          <input
            id="invite-file"
            className={ui.input}
            type="file"
            accept="text/csv"
            disabled={screen.reading}
            onChange={(event) => {
              handlers.onFile(event.target.files?.[0] ?? null);
            }}
          />
        </div>
      </div>
      {screen.reading && (
        <p className={ui.note} role="status">
          Reading the file...
        </p>
      )}
      {screen.refusal !== null && (
        <>
          <p className={ui.alert} role="alert">
            {FILE_REFUSAL_TEXT[screen.refusal]}
          </p>
          <p className={ui.note}>The file was not used. Nothing was sent.</p>
        </>
      )}
    </div>
  );
}

function Checked({
  screen,
  handlers,
}: {
  screen: Extract<Screen, { kind: 'checked' }>;
  handlers: UploadHandlers;
}) {
  return (
    <div className={ui.stack}>
      <p>
        Rows in file: <strong>{screen.rowsInFile}</strong>
      </p>
      <p>
        Ready to send: <strong>{screen.sendable}</strong>
      </p>
      {screen.issues.length > 0 && (
        <>
          <h3 className={ui.subtitle}>Rows that will not be sent</h3>
          <RefusedTable issues={screen.issues} />
        </>
      )}
      <div className={ui.row}>
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={screen.sendable === 0}
          onClick={handlers.onStart}
        >
          Start upload
        </button>
        <button type="button" className={ui.button} onClick={handlers.onChooseAnother}>
          Choose another file
        </button>
      </div>
    </div>
  );
}

function Results({ run }: { run: RunState }) {
  return (
    <div className={ui.stack}>
      <p>
        Rows in file: <strong>{run.rowsInFile}</strong>
      </p>
      <p>
        Invited: <strong>{run.invited}</strong>
      </p>
      {run.refused.length > 0 && (
        <>
          <h3 className={ui.subtitle}>Rows not invited</h3>
          <RefusedTable issues={run.refused} />
        </>
      )}
    </div>
  );
}

function Run({ run, handlers }: { run: RunState; handlers: UploadHandlers }) {
  const working =
    run.phase === 'running' || run.phase === 'completing' || run.phase === 'cancelling';
  return (
    <div className={ui.stack}>
      {run.reuploadWarning && (
        <p className={ui.note}>
          A file with the same contents was uploaded to this drive before. Rows already invited are
          listed as already invited.
        </p>
      )}
      {working && (
        <p role="status">
          {run.phase === 'cancelling'
            ? 'Stopping the upload...'
            : run.phase === 'completing'
              ? 'Finishing the upload...'
              : `Sending rows: ${String(run.rowsSent)} of ${String(run.rowsToSend)}`}
        </p>
      )}
      {run.busy && <p role="status">Sending the held rows again...</p>}
      {run.phase === 'completed' && <p role="status">Upload finished.</p>}
      {run.phase === 'cancelled' && (
        <p role="status">
          Upload cancelled. Anyone already invited stays invited; revoke them on the drive page if
          needed.
        </p>
      )}
      {run.failure !== null && (
        <p className={ui.alert} role="alert">
          {failureText(run.failure)}
        </p>
      )}
      {run.phase !== 'failed' && run.phase !== 'idle' && <Results run={run} />}
      {run.phase === 'ready' && (
        <HeldTable rowNos={run.held} busy={run.busy} onMarkDifferent={handlers.onMarkDifferent} />
      )}
      <div className={ui.row}>
        {run.phase === 'ready' && (
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={run.busy}
            onClick={handlers.onFinish}
          >
            Finish upload
          </button>
        )}
        {(run.phase === 'stopped' || run.phase === 'failed') && (
          <button type="button" className={`${ui.button} ${ui.primary}`} onClick={handlers.onRetry}>
            Try again
          </button>
        )}
        {run.phase === 'failed' && (
          <button type="button" className={ui.button} onClick={handlers.onChooseAnother}>
            Choose another file
          </button>
        )}
        {(run.phase === 'running' || run.phase === 'ready' || run.phase === 'stopped') && (
          <button
            type="button"
            className={ui.button}
            disabled={run.busy}
            onClick={handlers.onCancel}
          >
            Cancel upload
          </button>
        )}
        {(run.phase === 'completed' || run.phase === 'cancelled') && (
          <button type="button" className={ui.button} onClick={handlers.onChooseAnother}>
            Upload another file
          </button>
        )}
      </div>
    </div>
  );
}

export function UploadView({
  driveId,
  screen,
  handlers,
}: {
  driveId: string;
  screen: Screen;
  handlers: UploadHandlers;
}) {
  return (
    <section className={ui.stack}>
      <p>
        <Link to={`/drives/${driveId}`}>Back to the drive</Link>
      </p>
      <h2 className={ui.title}>Invite candidates</h2>
      {screen.kind === 'choose' && <Choose screen={screen} handlers={handlers} />}
      {screen.kind === 'checked' && <Checked screen={screen} handlers={handlers} />}
      {screen.kind === 'run' && <Run run={screen.run} handlers={handlers} />}
    </section>
  );
}
