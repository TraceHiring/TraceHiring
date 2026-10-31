// Registers the A5c settings screens for tests/m1-guards.test.tsx (AT-M1-24): synthetic-data renders of the integrity
// locks and members views, so D1's word lists and the no-checkbox rule apply to them.
import { IntegrityLockListResponse, MemberInviteView } from '@trace/shared/contracts/m1';
import type { ReactNode } from 'react';
import { IntegrityLocksView } from './IntegrityLocksRoute';
import { MembersView } from './MembersRoute';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AT = '2026-10-23T10:00:00.000Z';
const noop = () => undefined;

const locks = IntegrityLockListResponse.parse({
  locks: [
    {
      id: ID(1),
      settingKey: 'typing_provenance',
      lockedValue: 'on',
      lockedBy: ID(7),
      lockedAt: AT,
    },
    {
      id: ID(2),
      settingKey: 'paste_written',
      lockedValue: 'blocked',
      lockedBy: null,
      lockedAt: AT,
    },
  ],
}).locks;

const invite = (
  n: number,
  status: 'pending' | 'provisioned' | 'failed' | 'cancelled',
  roles: string[],
) =>
  MemberInviteView.parse({
    id: ID(n),
    roles,
    workspaceId: null,
    status,
    membershipId: status === 'provisioned' ? ID(n + 100) : null,
    invitedBy: ID(7),
    createdAt: AT,
  });

const members = {
  status: 'ready' as const,
  invites: [
    invite(1, 'pending', ['recruiter']),
    invite(2, 'provisioned', ['reviewer']),
    invite(3, 'failed', ['hiring_manager']),
    invite(4, 'cancelled', ['admin']),
  ],
  hasMore: true,
  loadingMore: false,
  form: { displayName: 'Synthetic Person', email: '', role: 'recruiter' },
  busy: false,
  error: null,
  notice: 'Invitation created.',
  onForm: noop,
  onInvite: noop,
  onCancel: noop,
  onMore: noop,
};

export function m1Screens(): Record<string, ReactNode> {
  return {
    'integrity-locks': (
      <IntegrityLocksView
        status="ready"
        locks={locks}
        drafts={{ single_screen: 'on' }}
        busy={false}
        error={null}
        onDraft={noop}
        onLock={noop}
        onUnlock={noop}
      />
    ),
    'integrity-locks-error': (
      <IntegrityLocksView
        status="ready"
        locks={[]}
        drafts={{}}
        busy={false}
        error="aal2_required"
        onDraft={noop}
        onLock={noop}
        onUnlock={noop}
      />
    ),
    members: <MembersView {...members} callerIsOwner={false} />,
    'members-owner': <MembersView {...members} callerIsOwner />,
  };
}
