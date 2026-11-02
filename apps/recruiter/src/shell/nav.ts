// What the signed-in shell shows each role (specs/d1-demo-slice.md §6.1). This is UX only: the server decides
// every request. A hiring_manager sees "no access in this release".

export interface NavItem {
  to: string;
  label: string;
}

const STAFF = new Set(['org_owner', 'admin', 'recruiter']);

export const isStaff = (roles: readonly string[]): boolean => roles.some((r) => STAFF.has(r));
export const isReviewer = (roles: readonly string[]): boolean => roles.includes('reviewer');

/** Any role that has a screen in D1. */
export const hasAccess = (roles: readonly string[]): boolean => isStaff(roles) || isReviewer(roles);

/**
 * Tests for everyone with access (a reviewer sees assigned tests only, the server filters); the reviewer's
 * "Review queue"; and the demo outbox for staff when the build has it (`extra`).
 */
export function navFor(roles: readonly string[], extra: NavItem | null): NavItem[] {
  if (!hasAccess(roles)) return [];
  const items: NavItem[] = [{ to: '/tests', label: 'Tests' }];
  if (isReviewer(roles)) items.push({ to: '/review', label: 'Review queue' });
  if (isStaff(roles) && extra !== null) items.push(extra);
  return items;
}

export const NO_ACCESS_TEXT = 'You have no access in this release.';
