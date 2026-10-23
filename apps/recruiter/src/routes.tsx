import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { useOrgInfo } from './api/runtime';
import { App, HealthPage, HomePage, RouteError } from './App';
import { AiDraftsRoute } from './bank/AiDraftsRoute';
import { ApprovalsRoute } from './bank/ApprovalsRoute';
import { BankRoute } from './bank/BankRoute';
import { ImportRoute } from './bank/import/ImportRoute';
import { ItemRoute } from './bank/ItemRoute';
import { PoolsRoute } from './bank/PoolsRoute';
import { InviteRoute } from './authoring/InvitePage';
import { ReviewersRoute } from './authoring/ReviewersPanel';
import { NewTestRoute, TestEditorRoute } from './authoring/TestEditorPage';
import { TestsRoute } from './authoring/TestsListPage';
import { LibraryRoute } from './library/LibraryRoute';
import { demoOutboxExtras, type DemoExtras } from './outbox/demo-extras';
import { ReportRoute } from './reports/ReportPage';
import { ResultsRoute } from './review/ResultsPage';
import { ReviewQueueRoute } from './review/ReviewQueuePage';
import { IntegrityLocksRoute } from './settings/IntegrityLocksRoute';
import { MembersRoute } from './settings/MembersRoute';
import { NO_ACCESS_TEXT, canReadBank, isAdmin, isStaff } from './shell/nav';
import { SignedInGate } from './shell/SignedIn';

/**
 * Shows `children` only to the roles `allow` accepts, otherwise the no-access text. UX only (M1 §6.10): the server
 * decides every request, so a screen the gate hides is also refused by the api and RLS.
 */
function RoleGate({
  allow,
  children,
}: {
  allow: (roles: readonly string[]) => boolean;
  children: ReactNode;
}) {
  const info = useOrgInfo();
  if (info === null || !allow(info.roles)) return <p role="status">{NO_ACCESS_TEXT}</p>;
  return children;
}
const gated = (allow: (roles: readonly string[]) => boolean, screen: ReactNode): ReactNode => (
  <RoleGate allow={allow}>{screen}</RoleGate>
);

/**
 * The route table (spec m0-foundations §3 D1; d1 spec §6.1). `demo` is the demo outbox (route and nav entry),
 * passed only by non-production builds; with null the table has no outbox route at all.
 */
export function buildRoutes(demo: DemoExtras | null): RouteObject[] {
  return [
    {
      path: '/',
      element: <App />,
      errorElement: <RouteError />,
      children: [
        { index: true, element: <HomePage /> },
        { path: 'health', element: <HealthPage /> },
        {
          element: <SignedInGate extraNav={demo === null ? null : demo.nav} />,
          children: [
            { path: 'tests', element: <TestsRoute /> },
            { path: 'tests/new', element: <NewTestRoute /> },
            { path: 'tests/:testId', element: <TestEditorRoute /> },
            { path: 'tests/:testId/reviewers', element: <ReviewersRoute /> },
            { path: 'tests/:testId/invite', element: <InviteRoute /> },
            { path: 'tests/:testId/results', element: <ResultsRoute /> },
            { path: 'reports/:reportId', element: <ReportRoute /> },
            { path: 'review', element: <ReviewQueueRoute /> },
            // M1 (specs/m1-test-authoring.md §6.10, §6.11; R5-54). Staff: owner, admin, recruiter. Reviewers read
            // the bank to approve items (the template choice is step 1 of tests/new, R5-15). Integrity locks and member invitations are admin only.
            { path: 'bank', element: gated(canReadBank, <BankRoute />) },
            { path: 'bank/items/new', element: gated(isStaff, <ItemRoute />) },
            { path: 'bank/items/:itemId', element: gated(canReadBank, <ItemRoute />) },
            { path: 'bank/approvals', element: gated(canReadBank, <ApprovalsRoute />) },
            { path: 'bank/ai-drafts', element: gated(isStaff, <AiDraftsRoute />) },
            { path: 'bank/pools', element: gated(isStaff, <PoolsRoute />) },
            { path: 'bank/import', element: gated(isStaff, <ImportRoute />) },
            { path: 'library', element: gated(isStaff, <LibraryRoute />) },
            { path: 'settings/integrity', element: gated(isAdmin, <IntegrityLocksRoute />) },
            { path: 'settings/members', element: gated(isAdmin, <MembersRoute />) },
            ...(demo === null ? [] : [demo.route]),
          ],
        },
      ],
    },
  ];
}

// The demo outbox gate (d1 spec §7.1, AT-D18): `VITE_DEMO_OUTBOX=1` and a `VITE_TRACE_ENV` of exactly `dev` or
// `staging` are both needed (an allow-list: unset, `production`, `prod` or any other value drops the outbox, even
// when the build inherits the flag). Both variables are replaced at build time; the condition is written inline
// (not through a helper) so that when it is constant-false the bundler drops the outbox module, its route, path,
// labels and the lazy import of the screen. The bundle check script skips in exactly this case.
export const routes: RouteObject[] = buildRoutes(
  import.meta.env.VITE_DEMO_OUTBOX === '1' &&
    (import.meta.env.VITE_TRACE_ENV === 'dev' || import.meta.env.VITE_TRACE_ENV === 'staging')
    ? demoOutboxExtras
    : null,
);
