// The caller's own membership in the path org, read as the caller (m0b §2.2 S18: a person can always read their own
// membership rows, at any aal). Neutral code for the org modules that narrow a route to some roles before RLS runs
// (assignments, invitations, the demo outbox). It only ever narrows: every read and write after it still goes
// through RLS, so a gate that passes here cannot widen what the database allows.
import { OrgRole } from '@trace/shared/contracts/tenancy';
import { z } from 'zod';
import { parseRows } from './authoring.js';
import { eq, orgFail, type OrgCaller, type Rest } from './org-context.js';

export type Role = OrgRole;

const MembershipRow = z.object({ id: z.uuid(), roles: z.array(OrgRole).min(1) });

export interface CallerMembership {
  id: string;
  roles: Role[];
}

const PRIVILEGED: readonly Role[] = ['org_owner', 'admin', 'reviewer'];

/**
 * private.membership_counts_for, the same truth table (m0b §2.2, L-25): aal2 counts; a membership holding a
 * privileged role counts only at aal2; otherwise aal1 counts only after an email OTP or magic link and no password.
 * Used only to answer `aal2_required` instead of an empty result; RLS applies the database's own copy anyway.
 */
export const membershipCounts = (
  roles: readonly Role[],
  aal: OrgCaller['aal'],
  amr: readonly string[],
): boolean => {
  if (aal === 'aal2') return true;
  if (roles.some((r) => PRIVILEGED.includes(r))) return false;
  return (amr.includes('otp') || amr.includes('magiclink')) && !amr.includes('password');
};

/** The caller's active membership in `orgId`, or null. */
export const loadCallerMembership = async (
  rest: Rest,
  caller: OrgCaller,
  orgId: string,
): Promise<CallerMembership | null> => {
  const rows = parseRows(
    MembershipRow,
    await rest.select('memberships', {
      select: 'id,roles',
      org_id: eq(orgId),
      user_id: eq(caller.userId),
      status: 'eq.active',
    }),
  );
  return rows[0] ?? null;
};

/**
 * The caller's membership if it holds one of `allowed` and counts at this aal. No such membership is 404 (the org is
 * not theirs to see); one that does not count is 403 `aal2_required` (it is the caller's own state, S18).
 */
export const requireRole = async (
  rest: Rest,
  caller: OrgCaller,
  orgId: string,
  allowed: readonly Role[],
): Promise<CallerMembership> => {
  const m = await loadCallerMembership(rest, caller, orgId);
  if (m === null || !m.roles.some((r) => allowed.includes(r))) return orgFail('not_found');
  if (!membershipCounts(m.roles, caller.aal, caller.amr)) return orgFail('aal2_required');
  return m;
};
