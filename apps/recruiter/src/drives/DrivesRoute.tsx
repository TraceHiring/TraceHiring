// `/drives` (specs/m2-scheduling-invites.md §6.1, M2-8, R5-31): the org's drives in cursor pages, with the window in
// IST, a link to each drive and one to a new drive. Staff only (the route table gates it; the server decides).
import type { DriveSummary } from '@trace/shared/contracts/m2';
import { useCallback } from 'react';
import { Link } from 'react-router';
import { listDrives } from '../api/endpoints';
import { useApi } from '../api/runtime';
import ui from '../common/Ui.module.css';
import { driveErrorText } from './messages';
import { PagerControls } from './PagerControls';
import { DRIVE_STATUS_LABEL, MODE_LABEL } from './texts';
import { formatIst } from './time';
import { usePager, type PagerState } from './use-pager';

export interface DrivesViewProps {
  state: PagerState<DriveSummary>;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious(): void;
  onNext(): void;
}

export function DrivesView({ state, hasPrevious, hasNext, onPrevious, onNext }: DrivesViewProps) {
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>Drives</h2>
      <p>
        <Link className={`${ui.button} ${ui.primary}`} to="/drives/new">
          New drive
        </Link>
      </p>
      {state.kind === 'loading' && <p role="status">Loading...</p>}
      {state.kind === 'error' && (
        <p role="alert" className={ui.alert}>
          {driveErrorText(state.code)}
        </p>
      )}
      {state.kind === 'ready' &&
        (state.rows.length === 0 ? (
          <p className={ui.note}>No drives yet.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Mode</th>
                <th scope="col">Status</th>
                <th scope="col">Opens</th>
                <th scope="col">Deadline</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((drive) => (
                <tr key={drive.id}>
                  <th scope="row">
                    <Link to={`/drives/${drive.id}`}>{drive.name}</Link>
                  </th>
                  <td>{MODE_LABEL[drive.mode]}</td>
                  <td>{DRIVE_STATUS_LABEL[drive.status]}</td>
                  <td>{formatIst(drive.opensAt)}</td>
                  <td>{formatIst(drive.deadlineAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      <PagerControls
        hasPrevious={hasPrevious}
        hasNext={hasNext}
        onPrevious={onPrevious}
        onNext={onNext}
      />
    </section>
  );
}

export function DrivesRoute() {
  const api = useApi();
  const load = useCallback(
    async (cursor: string | undefined) => {
      if (api === null) return { ok: false as const, code: 'unauthorized' };
      const result = await listDrives(api, cursor === undefined ? undefined : { cursor });
      return result.ok
        ? {
            ok: true as const,
            data: { rows: result.data.drives, nextCursor: result.data.nextCursor },
          }
        : result;
    },
    [api],
  );
  const pager = usePager<DriveSummary>(api === null ? null : load);
  return (
    <DrivesView
      state={pager.state}
      hasPrevious={pager.hasPrevious}
      hasNext={pager.hasNext}
      onPrevious={pager.previous}
      onNext={pager.next}
    />
  );
}
