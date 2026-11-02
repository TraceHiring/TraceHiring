// The reviewer's queue (specs/d1-demo-slice.md §6.1, aal2): assigned reports across assigned tests, newest first,
// the same quality-only row shape as the results. No band and no integrity value appear here (rule 6).
import type { ReviewQueueResponse } from '@trace/shared/contracts/d1';
import { useCallback } from 'react';
import { Link } from 'react-router';
import { reviewQueue } from '../api/endpoints';
import { useApi } from '../api/runtime';
import { formatTime } from '../common/format';
import { errorText } from '../common/messages';
import { useResource } from '../common/useResource';
import ui from '../common/Ui.module.css';
import { QualityCell } from './ResultsPage';

type QueueRow = ReviewQueueResponse['reports'][number];

export function sortNewestFirst<T extends QueueRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
}

export function ReviewQueueView({ data }: { data: ReviewQueueResponse }) {
  const rows = sortNewestFirst(data.reports);
  if (rows.length === 0) return <p>No reports are assigned to you yet.</p>;
  return (
    <table className={ui.table}>
      <caption className={ui.note}>Newest first</caption>
      <thead>
        <tr>
          <th scope="col">Candidate</th>
          <th scope="col">Test</th>
          <th scope="col">Answer Quality</th>
          <th scope="col">Submitted</th>
          <th scope="col">Report</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.reportId}>
            <th scope="row">{row.label}</th>
            <td>{row.testName}</td>
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
  );
}

export function ReviewQueueRoute() {
  const api = useApi();
  const load = useCallback(
    () =>
      api === null
        ? Promise.resolve({ ok: false as const, code: 'unauthorized' })
        : reviewQueue(api),
    [api],
  );
  const [state] = useResource(load);
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>Review queue</h2>
      {state.kind === 'loading' && <p role="status">Loading...</p>}
      {state.kind === 'error' && (
        <p role="alert" className={ui.alert}>
          {errorText(state.code)}
        </p>
      )}
      {state.kind === 'ready' && <ReviewQueueView data={state.data} />}
    </section>
  );
}
