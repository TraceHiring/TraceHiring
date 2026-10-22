// `/tests` (specs/d1-demo-slice.md §6.1): name, status (draft / published vN), invitations, link to results.
// A reviewer sees the tests assigned to them (the server filters) and has no "New test".
import type { TestListResponse } from '@trace/shared/contracts/d1';
import { useCallback } from 'react';
import { Link } from 'react-router';
import { listTests } from '../api/endpoints';
import { useApi, useOrgInfo } from '../api/runtime';
import { errorText } from '../common/messages';
import { useResource } from '../common/useResource';
import ui from '../common/Ui.module.css';
import { isStaff } from '../shell/nav';

type TestRow = TestListResponse['tests'][number];

export const statusText = (test: TestRow): string =>
  test.status === 'draft'
    ? 'Draft'
    : test.status === 'published'
      ? `Published v${test.versionNo}`
      : `Retired v${test.versionNo}`;

/** `canCreate` is true for staff (owner, admin, recruiter): only they get "New test", the editor link and "Invite". */
export function TestsView({ data, canCreate }: { data: TestListResponse; canCreate: boolean }) {
  return (
    <div className={ui.stack}>
      {canCreate && (
        <p>
          <Link to="/tests/new">New test</Link>
        </p>
      )}
      {data.tests.length === 0 ? (
        <p>No tests yet.</p>
      ) : (
        <table className={ui.table}>
          <thead>
            <tr>
              <th scope="col">Test</th>
              <th scope="col">Status</th>
              <th scope="col">Invitations</th>
              <th scope="col">Links</th>
            </tr>
          </thead>
          <tbody>
            {data.tests.map((test) => (
              <tr key={test.id}>
                <th scope="row">{test.name}</th>
                <td>{statusText(test)}</td>
                <td>{test.invitationCount}</td>
                <td className={ui.row}>
                  {canCreate && (
                    <Link to={`/tests/${test.id}`}>
                      {test.status === 'draft' ? 'Edit' : 'Open'}
                    </Link>
                  )}
                  <Link to={`/tests/${test.id}/results`}>Results</Link>
                  {canCreate && test.status === 'published' && (
                    <Link to={`/tests/${test.id}/invite`}>Invite</Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function TestsRoute() {
  const api = useApi();
  const info = useOrgInfo();
  const load = useCallback(
    () =>
      api === null ? Promise.resolve({ ok: false as const, code: 'unauthorized' }) : listTests(api),
    [api],
  );
  const [state] = useResource(load);
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>Tests</h2>
      {state.kind === 'loading' && <p role="status">Loading...</p>}
      {state.kind === 'error' && (
        <p role="alert" className={ui.alert}>
          {errorText(state.code)}
        </p>
      )}
      {state.kind === 'ready' && (
        <TestsView data={state.data} canCreate={info !== null && isStaff(info.roles)} />
      )}
    </section>
  );
}
