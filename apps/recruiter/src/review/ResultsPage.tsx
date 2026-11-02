// Results of one test (specs/d1-demo-slice.md §6.1, §6.3): Answer Quality only. The cutoff is shown read-only;
// "Below cutoff" is plain text, not a control. There is no band column, no row selection, no bulk bar, no export.
import type { ResultsListResponse } from '@trace/shared/contracts/d1';
import { useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { testResults } from '../api/endpoints';
import { useApi } from '../api/runtime';
import { errorText } from '../common/messages';
import { formatTime } from '../common/format';
import { useResource } from '../common/useResource';
import ui from '../common/Ui.module.css';

export type Row = ResultsListResponse['rows'][number];

/** Score high to low; rows without a score yet come last. Ties keep the api order. */
export function sortByScoreDesc<T extends Row>(rows: readonly T[]): T[] {
  const score = (row: Row): number => (row.quality.state === 'ready' ? row.quality.score : -1);
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => score(b.row) - score(a.row) || a.index - b.index)
    .map((entry) => entry.row);
}

export function QualityCell({ quality }: { quality: Row['quality'] }) {
  if (quality.state === 'pending') return <span>Scoring...</span>;
  return (
    <span>
      {quality.score}
      {quality.belowCutoff ? ' · Below cutoff' : ''}
    </span>
  );
}

export function ResultsView({ data }: { data: ResultsListResponse }) {
  const rows = sortByScoreDesc(data.rows);
  return (
    <div className={ui.stack}>
      <p className={ui.note}>
        Answer Quality cutoff: {data.cutoff} (set when the test was published; it cannot change)
      </p>
      {rows.length === 0 ? (
        <p>No submitted answers yet.</p>
      ) : (
        <table className={ui.table}>
          <caption className={ui.note}>Sorted by Answer Quality, highest first</caption>
          <thead>
            <tr>
              <th scope="col">Candidate</th>
              <th scope="col">Answer Quality</th>
              <th scope="col">Submitted</th>
              <th scope="col">Report</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.reportId}>
                <th scope="row">{row.label}</th>
                <td>
                  <QualityCell quality={row.quality} />
                </td>
                <td>{formatTime(row.submittedAt)}</td>
                <td>
                  <Link to={`/reports/${row.reportId}`}>Open report</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ResultsRoute() {
  const { testId } = useParams();
  const api = useApi();
  const valid = testId !== undefined && UUID.test(testId);
  const load = useCallback(
    () =>
      api !== null && valid
        ? testResults(api, testId)
        : Promise.resolve({ ok: false as const, code: 'not_found' }),
    [api, testId, valid],
  );
  const [state] = useResource(load);
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>Results</h2>
      {state.kind === 'loading' && <p role="status">Loading...</p>}
      {state.kind === 'error' && (
        <p role="alert" className={ui.alert}>
          {errorText(state.code)}
        </p>
      )}
      {state.kind === 'ready' && <ResultsView data={state.data} />}
    </section>
  );
}
