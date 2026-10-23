// `/settings/members` (admin; specs/m1-test-authoring.md §4.5, §6.11, R2-14, R5-53 c): invite a member with a role,
// list the invites in cursor pages, cancel a pending one. Only an owner can invite an owner (the server enforces it), so
// the choice is hidden from everyone else. The address is sent once and never shown again: the form clears on success
// and the invite view carries no address, name or HMAC. Screen access is UX only; invites need a two-step sign-in.
import type { MemberInviteStatus, MemberInviteView } from '@trace/shared/contracts/m1';
import { OrgRole } from '@trace/shared/contracts/tenancy';
import { useEffect, useState, type FormEvent } from 'react';
import { cancelMemberInvite, createMemberInvite, listMemberInvites } from '../api/endpoints';
import { useApi, useOrgInfo } from '../api/runtime';
import { formatTime } from '../common/format';
import { errorText } from '../common/messages';
import ui from '../common/Ui.module.css';

const ROLE_LABEL: Readonly<Record<OrgRole, string>> = {
  org_owner: 'Owner',
  admin: 'Admin',
  recruiter: 'Recruiter',
  reviewer: 'Reviewer',
  hiring_manager: 'Hiring manager',
};
const STATUS_LABEL: Readonly<Record<MemberInviteStatus, string>> = {
  pending: 'Pending',
  provisioned: 'Set up',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
const roleLabel = (role: string): string => ROLE_LABEL[role as OrgRole] ?? role;

/** The roles the caller may offer: Owner only when the caller is an owner (R2-14). */
export const invitableRoles = (callerIsOwner: boolean): OrgRole[] => [
  ...(callerIsOwner ? (['org_owner'] as const) : []),
  'admin',
  'recruiter',
  'reviewer',
  'hiring_manager',
];

export interface InviteForm {
  displayName: string;
  email: string;
  role: string;
}

export interface MembersViewProps {
  status: 'loading' | 'ready' | 'error';
  callerIsOwner: boolean;
  invites: readonly MemberInviteView[];
  hasMore: boolean;
  loadingMore: boolean;
  form: InviteForm;
  busy: boolean;
  /** An api failure code, shown as fixed text. */
  error: string | null;
  notice: string | null;
  onForm(patch: Partial<InviteForm>): void;
  onInvite(): void;
  onCancel(inviteId: string): void;
  onMore(): void;
}

export function MembersView(props: MembersViewProps) {
  const canSend =
    props.form.displayName.trim() !== '' && props.form.email.trim() !== '' && !props.busy;
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>Members</h2>
      {props.status === 'loading' && <p role="status">Loading...</p>}
      {props.status !== 'loading' && (
        <form
          className={ui.form}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (canSend) props.onInvite();
          }}
        >
          <h3 className={ui.subtitle}>Invite a member</h3>
          <label className={ui.field}>
            <span className={ui.label}>Display name</span>
            <input
              className={ui.input}
              type="text"
              maxLength={120}
              autoComplete="off"
              value={props.form.displayName}
              onChange={(e) => {
                props.onForm({ displayName: e.target.value });
              }}
            />
          </label>
          <label className={ui.field}>
            <span className={ui.label}>Email address</span>
            <input
              className={ui.input}
              type="email"
              maxLength={254}
              autoComplete="off"
              value={props.form.email}
              onChange={(e) => {
                props.onForm({ email: e.target.value });
              }}
            />
          </label>
          <label className={ui.field}>
            <span className={ui.label}>Role</span>
            <select
              className={ui.select}
              value={props.form.role}
              onChange={(e) => {
                props.onForm({ role: e.target.value });
              }}
            >
              {invitableRoles(props.callerIsOwner).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </label>
          <p className={ui.note}>
            The address is used once to send the invitation and is not shown again.
          </p>
          <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={!canSend}>
            Send invite
          </button>
        </form>
      )}
      {props.notice !== null && <p role="status">{props.notice}</p>}
      {props.error !== null && (
        <p role="alert" className={ui.alert}>
          {errorText(props.error)}
        </p>
      )}
      {props.status === 'ready' && (
        <>
          <h3 className={ui.subtitle}>Invitations</h3>
          {props.invites.length === 0 ? (
            <p className={ui.note}>No invitations yet.</p>
          ) : (
            <table className={ui.table}>
              <thead>
                <tr>
                  <th scope="col">Roles</th>
                  <th scope="col">Status</th>
                  <th scope="col">Invited</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {props.invites.map((invite) => (
                  <tr key={invite.id}>
                    <th scope="row">{invite.roles.map(roleLabel).join(', ')}</th>
                    <td>{STATUS_LABEL[invite.status]}</td>
                    <td>{formatTime(invite.createdAt)}</td>
                    <td>
                      {invite.status === 'pending' && (
                        <button
                          type="button"
                          className={ui.button}
                          disabled={props.busy}
                          onClick={() => {
                            props.onCancel(invite.id);
                          }}
                        >
                          Cancel invite
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {props.hasMore && (
            <p>
              <button
                type="button"
                className={ui.button}
                disabled={props.loadingMore}
                onClick={props.onMore}
              >
                Load more invites
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}

const EMPTY_FORM: InviteForm = { displayName: '', email: '', role: 'recruiter' };

export function MembersRoute() {
  const api = useApi();
  const info = useOrgInfo();
  const callerIsOwner = info !== null && info.roles.includes('org_owner');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [invites, setInvites] = useState<MemberInviteView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [form, setForm] = useState<InviteForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (api === null) return;
    let live = true;
    void listMemberInvites(api).then((result) => {
      if (!live) return;
      if (result.ok) {
        setInvites(result.data.invites);
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
    const result = await listMemberInvites(api, { cursor: nextCursor });
    setLoadingMore(false);
    if (result.ok) {
      setInvites((current) => [...current, ...result.data.invites]);
      setNextCursor(result.data.nextCursor);
    } else {
      setError(result.code);
    }
  };

  const invite = async () => {
    const role = OrgRole.safeParse(form.role);
    if (api === null || !role.success) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await createMemberInvite(api, {
      email: form.email.trim(),
      roles: [role.data],
      displayName: form.displayName.trim(),
    });
    setBusy(false);
    if (result.ok) {
      // The address is gone from the screen the moment it is sent.
      setForm(EMPTY_FORM);
      setInvites((current) => [result.data, ...current]);
      setNotice('Invitation created.');
    } else {
      setError(result.code);
    }
  };

  const cancel = async (inviteId: string) => {
    if (api === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await cancelMemberInvite(api, inviteId);
    setBusy(false);
    if (result.ok) {
      setInvites((current) => current.map((i) => (i.id === inviteId ? result.data : i)));
    } else {
      setError(result.code);
    }
  };

  return (
    <MembersView
      status={status}
      callerIsOwner={callerIsOwner}
      invites={invites}
      hasMore={nextCursor !== null}
      loadingMore={loadingMore}
      form={form}
      busy={busy}
      error={error}
      notice={notice}
      onForm={(patch) => {
        setForm((f) => ({ ...f, ...patch }));
      }}
      onInvite={() => void invite()}
      onCancel={(id) => void cancel(id)}
      onMore={() => void more()}
    />
  );
}

export default MembersRoute;
