// One member invitation (specs/m1-test-authoring.md M1-20, R2-14, R5-35, R5-56 c, §4.5, §7 E26, E27).
//
// 1. Without the pepper the job fails closed (a constant error; the message is retried, the invite stays pending).
// 2. Stage 1 (one transaction as trace_admin_worker): read the invite in the job org. Unknown, or not pending: skipped
//    (a provisioned invite is the idempotent re-delivery). HMAC(normalised address, pepper) must equal the row's
//    email_hmac (constant-time) before anything else happens; a mismatch settles the invite as failed and never
//    reaches the Auth API.
// 3. Outside any transaction: the Auth admin API creates the user, or reuses it (E26).
// 4. Stage 2: private.provision_invited_member(invite, user, display name) inserts the invited membership with the
//    invite row's roles and workspace and marks the invite provisioned (the message has no roles). A guard refusal
//    (the inviter is no longer an admin, the user already has a membership, a bad name, the invite is no longer
//    pending) settles the invite as failed in a fresh transaction; any other error propagates (retried).
// The address and display name are never logged or put in an error; logs carry the invite id and the outcome only.
import type { AdminQueueMessage } from '@trace/shared/contracts/m1';
import type { Logger } from '@trace/shared/log';
import type { AuthAdmin } from './auth-admin.js';
import { hexEqual, inviteEmailHmac } from './email-hmac.js';
import type { InviteStore } from './store.js';

/** Runs `fn` in one transaction as trace_admin_worker bound to `orgId` (queue/stage-db.ts in production). */
export interface MembersDb {
  run<T>(orgId: string, fn: (store: InviteStore) => Promise<T>): Promise<T>;
}

export interface MembersDeps {
  db: MembersDb;
  authAdmin: AuthAdmin;
  /** MEMBER_INVITE_PEPPER (a jobs Worker secret); undefined or empty fails closed. */
  pepper: string | undefined;
  log: Logger;
}

export type InviteOutcome = 'provisioned' | 'failed' | 'skipped';

export const PEPPER_UNAVAILABLE = 'member_invite_pepper_unavailable';

/** SQLSTATEs of the provisioning guard's refusals (42501 TRACE_GUARD, 23505 TRACE_GUARD, 22023 TRACE_BAD_INPUT). */
const REFUSALS = new Set(['42501', '23505', '22023']);

/** True for a refusal raised by the guard itself (not, say, a missing grant, which is retried). */
export const isGuardRefusal = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  return (
    typeof code === 'string' &&
    REFUSALS.has(code) &&
    typeof message === 'string' &&
    (message.startsWith('TRACE_GUARD:') || message.startsWith('TRACE_BAD_INPUT:'))
  );
};

/** Settles a pending invite as failed in its own transaction; false when it is not pending in the job org. */
export const failInvite = (
  msg: Pick<AdminQueueMessage, 'inviteId' | 'orgId'>,
  deps: Pick<MembersDeps, 'db' | 'log'>,
  reason: 'email_mismatch' | 'refused' | 'retries_exhausted',
): Promise<boolean> =>
  deps.db.run(msg.orgId, async (s) => {
    const done = await s.markFailed(msg.inviteId);
    if (done) deps.log.warn('members.invite_failed', { inviteId: msg.inviteId, reason });
    return done;
  });

/** Runs one invitation to its end. Throws on a missing pepper, an Auth API error or a database error (retried). */
export const handleInviteMessage = async (
  msg: AdminQueueMessage,
  deps: MembersDeps,
): Promise<InviteOutcome> => {
  if (deps.pepper === undefined || deps.pepper === '') throw new Error(PEPPER_UNAVAILABLE);
  const hmac = await inviteEmailHmac(msg.email, deps.pepper);

  const checked = await deps.db.run(msg.orgId, async (s) => {
    const invite = await s.loadInvite(msg.inviteId);
    if (invite === null) return 'missing' as const;
    if (invite.status !== 'pending') return 'settled' as const;
    if (!hexEqual(hmac, invite.email_hmac)) {
      await s.markFailed(invite.id);
      return 'mismatch' as const;
    }
    return 'go' as const;
  });
  if (checked === 'missing') {
    deps.log.warn('members.invite_not_found', { inviteId: msg.inviteId });
    return 'skipped';
  }
  if (checked === 'settled') {
    deps.log.info('members.invite_already_settled', { inviteId: msg.inviteId });
    return 'skipped';
  }
  if (checked === 'mismatch') {
    deps.log.warn('members.invite_failed', { inviteId: msg.inviteId, reason: 'email_mismatch' });
    return 'failed';
  }

  const userId = await deps.authAdmin.ensureUser(msg.email);

  try {
    await deps.db.run(msg.orgId, (s) => s.provision(msg.inviteId, userId, msg.displayName));
  } catch (err) {
    if (!isGuardRefusal(err)) throw err;
    await failInvite(msg, deps, 'refused');
    return 'failed';
  }
  deps.log.info('members.invite_provisioned', { inviteId: msg.inviteId });
  return 'provisioned';
};
