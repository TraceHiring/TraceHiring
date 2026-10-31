// Reviewers panel for a test (specs/d1-demo-slice.md §6.1, L-16, R-15): who is assigned, assign and unassign.
// Visible to owner, admin and a recruiter assigned to this test; for anyone else the api answers 404 and the panel
// is not shown. Every role needs an assignment to view the start photo.
import type { AssignmentListResponse } from '@trace/shared/contracts/d1';
import { useCallback, useContext, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { createAssignment, deleteAssignment, listAssignments } from '../api/endpoints';
import { RuntimeContext, useApi, useOrgInfo } from '../api/runtime';
import { errorText } from '../common/messages';
import { useResource } from '../common/useResource';
import ui from '../common/Ui.module.css';
import { loadDirectory, type Member } from './directory';

type Role = 'org_owner' | 'admin' | 'recruiter' | 'reviewer';

/** A recruiter assigns reviewers only; an owner or admin may assign any role (RLS and the api decide). */
export function assignableRoles(callerRoles: readonly string[]): Role[] {
  const wide = callerRoles.includes('org_owner') || callerRoles.includes('admin');
  return wide ? ['reviewer', 'recruiter', 'admin', 'org_owner'] : ['reviewer'];
}

const ROLE_LABEL: Readonly<Record<Role, string>> = {
  reviewer: 'Reviewer',
  recruiter: 'Recruiter',
  admin: 'Admin',
  org_owner: 'Owner',
};

export function ReviewersPanelView({
  assignments,
  members,
  roles,
  busy,
  error,
  onAssign,
  onUnassign,
}: {
  assignments: AssignmentListResponse;
  members: readonly Member[];
  roles: readonly string[];
  busy: boolean;
  error: string | null;
  onAssign(membershipId: string, role: Role): void;
  onUnassign(assignmentId: string): void;
}) {
  const assigned = new Set(assignments.assignments.map((a) => a.membershipId));
  const candidates = members.filter((m) => !assigned.has(m.id));
  const asRoles = assignableRoles(roles);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const membershipId = data.get('member');
    const role = data.get('role');
    if (typeof membershipId === 'string' && typeof role === 'string' && membershipId !== '') {
      onAssign(membershipId, role as Role);
    }
  };
  return (
    <section className={ui.stack} aria-labelledby="reviewers-title">
      <h3 id="reviewers-title" className={ui.subtitle}>
        Reviewers
      </h3>
      <p className={ui.note}>
        Everyone, in every role, needs an assignment to this test to view a candidate's start photo.
      </p>
      {error !== null && (
        <p role="alert" className={ui.alert}>
          {errorText(error)}
        </p>
      )}
      {assignments.assignments.length === 0 ? (
        <p>No one is assigned yet.</p>
      ) : (
        <ul className={ui.items}>
          {assignments.assignments.map((a) => (
            <li key={a.id} className={ui.row}>
              <span>
                {a.displayName} ({ROLE_LABEL[a.asRole]})
              </span>
              <button
                type="button"
                className={ui.button}
                disabled={busy}
                aria-label={`Unassign ${a.displayName}`}
                onClick={() => {
                  onUnassign(a.id);
                }}
              >
                Unassign
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className={ui.form} onSubmit={submit}>
        <label className={ui.field}>
          <span className={ui.label}>Member</span>
          <select className={ui.select} name="member" required defaultValue="">
            <option value="">Choose a member</option>
            {candidates.map((m) => (
              <option key={m.id} value={m.id}>
                {`${m.displayName} (${m.roles.join(', ')})`}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Assign as</span>
          <select className={ui.select} name="role" defaultValue="reviewer">
            {asRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={ui.button} disabled={busy}>
          Assign
        </button>
      </form>
    </section>
  );
}

/** The panel for one test; renders nothing when the api says the caller may not see it. */
export function ReviewersPanel({ testId }: { testId: string }) {
  const api = useApi();
  const info = useOrgInfo();
  const runtime = useContext(RuntimeContext);
  const loadAssignments = useCallback(
    () =>
      api === null
        ? Promise.resolve({ ok: false as const, code: 'unauthorized' })
        : listAssignments(api, testId),
    [api, testId],
  );
  const loadMembers = useCallback(
    () =>
      runtime === null || info === null
        ? Promise.resolve({ ok: false as const, code: 'unavailable' })
        : loadDirectory(runtime.supabase, info.orgId),
    [runtime, info],
  );
  const [list] = useResource(loadAssignments);
  const [directory] = useResource(loadMembers);
  const [current, setCurrent] = useState<AssignmentListResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (api === null || info === null) return null;
  if (list.kind === 'error' && list.code === 'not_found') return null;
  if (list.kind === 'loading' || directory.kind === 'loading') {
    return <p role="status">Loading reviewers...</p>;
  }
  if (list.kind === 'error') {
    return (
      <p role="alert" className={ui.alert}>
        {errorText(list.code)}
      </p>
    );
  }
  const assignments = current ?? list.data;
  const run = async (action: () => ReturnType<typeof createAssignment>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) setCurrent(result.data);
    else setError(result.code);
  };
  return (
    <ReviewersPanelView
      assignments={assignments}
      members={directory.kind === 'ready' ? directory.data : []}
      roles={info.roles}
      busy={busy}
      error={error ?? (directory.kind === 'error' ? directory.code : null)}
      onAssign={(membershipId, asRole) => {
        void run(() => createAssignment(api, testId, { membershipId, asRole }));
      }}
      onUnassign={(assignmentId) => {
        void run(() => deleteAssignment(api, testId, assignmentId));
      }}
    />
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route `/tests/:testId/reviewers`: the panel on its own page. */
export function ReviewersRoute() {
  const { testId } = useParams();
  if (testId === undefined || !UUID.test(testId)) return <p role="alert">Test not found.</p>;
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>Reviewers</h2>
      <ReviewersPanel testId={testId} />
    </section>
  );
}
