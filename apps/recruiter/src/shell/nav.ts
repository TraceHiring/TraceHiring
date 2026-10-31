// What the signed-in shell shows each role (specs/d1-demo-slice.md §6.1; M1: specs/m1-test-authoring.md §2, §6.10).
// This is UX only: the server decides every request. A hiring_manager sees "no access in this release".

export interface NavItem {
  to: string;
  label: string;
}

const STAFF = new Set(['org_owner', 'admin', 'recruiter']);

export const isStaff = (roles: readonly string[]): boolean => roles.some((r) => STAFF.has(r));
export const isReviewer = (roles: readonly string[]): boolean => roles.includes('reviewer');
/** Admin only (M1 §2): integrity locks and member invitations. An owner is not an admin here. */
export const isAdmin = (roles: readonly string[]): boolean => roles.includes('admin');
/** The bank and an item's detail are read by staff and, to approve items, by reviewers (M1 §2, §6.11). */
export const canReadBank = (roles: readonly string[]): boolean =>
  isStaff(roles) || isReviewer(roles);

/** Any role that has a screen in D1. */
export const hasAccess = (roles: readonly string[]): boolean => isStaff(roles) || isReviewer(roles);

/**
 * Tests for everyone with access (a reviewer sees assigned tests only, the server filters). M1: the item bank and
 * the library for staff; the item approval queue for staff and reviewers; integrity settings and members for admins.
 * Then the reviewer's integrity "Review queue", and the demo outbox for staff when the build has it (`extra`).
 */
export function navFor(roles: readonly string[], extra: NavItem | null): NavItem[] {
  if (!hasAccess(roles)) return [];
  const items: NavItem[] = [{ to: '/tests', label: 'Tests' }];
  if (isStaff(roles)) items.push({ to: '/bank', label: 'Item bank' });
  if (canReadBank(roles)) items.push({ to: '/bank/approvals', label: 'Item approvals' });
  if (isStaff(roles)) items.push({ to: '/library', label: 'Library' });
  if (isAdmin(roles)) {
    items.push({ to: '/settings/integrity', label: 'Integrity settings' });
    items.push({ to: '/settings/members', label: 'Members' });
  }
  if (isReviewer(roles)) items.push({ to: '/review', label: 'Review queue' });
  if (isStaff(roles) && extra !== null) items.push(extra);
  return items;
}

export const NO_ACCESS_TEXT = 'You have no access in this release.';
