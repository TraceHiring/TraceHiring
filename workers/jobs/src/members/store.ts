// SQL of member provisioning (specs/m1-test-authoring.md M1-20, R2-14, R5-35, R5-50 c), run as trace_admin_worker
// inside one transaction per stage with trace.job_org_id bound (queue/stage-db.ts). The worker holds SELECT and
// UPDATE (status) on its job org's member_invites and EXECUTE on private.provision_invited_member; memberships only
// through that function, which copies the roles and workspace from the invite row (never from the message), re-checks
// the inviter (R2-14) and refuses an invite outside the job org. Constant SQL text, bound parameters only; the address
// is never a parameter of any statement here.
import type { SqlTx } from '@trace/shared/jobs';

export const SQL = {
  loadInvite:
    'select id::text as id, email_hmac, status, membership_id::text as membership_id ' +
    'from public.member_invites where org_id = (select private.job_org_id()) and id = $1::uuid',
  markFailed:
    "update public.member_invites set status = 'failed' where org_id = (select private.job_org_id()) " +
    "and id = $1::uuid and status = 'pending' returning id::text as id",
  provision:
    'select private.provision_invited_member($1::uuid, $2::uuid, $3)::text as membership_id',
} as const;

export type InviteStatus = 'pending' | 'provisioned' | 'failed' | 'cancelled';

export interface InviteRow {
  id: string;
  email_hmac: string;
  status: InviteStatus;
  membership_id: string | null;
}

export interface InviteStore {
  /** The invite in the job org, or null (unknown, or another org's: RLS hides it). */
  loadInvite(inviteId: string): Promise<InviteRow | null>;
  /** pending → failed; false when the invite is not pending in the job org. */
  markFailed(inviteId: string): Promise<boolean>;
  /** private.provision_invited_member: the invited membership's id. Throws the guard's error on a refusal. */
  provision(inviteId: string, userId: string, displayName: string): Promise<string>;
}

export const sqlInviteStore = (tx: SqlTx): InviteStore => ({
  loadInvite: async (inviteId) => {
    const [row] = await tx.query<InviteRow>(SQL.loadInvite, [inviteId]);
    return row ?? null;
  },
  markFailed: async (inviteId) => (await tx.query(SQL.markFailed, [inviteId])).length > 0,
  provision: async (inviteId, userId, displayName) => {
    const [row] = await tx.query<{ membership_id: string | null }>(SQL.provision, [
      inviteId,
      userId,
      displayName,
    ]);
    if (typeof row?.membership_id !== 'string') throw new Error('member_invite_not_provisioned');
    return row.membership_id;
  },
});
