import type { RouteObject } from 'react-router';
import { App, HealthPage, HomePage, RouteError } from './App';
import { InviteRoute } from './authoring/InvitePage';
import { ReviewersRoute } from './authoring/ReviewersPanel';
import { NewTestRoute, TestEditorRoute } from './authoring/TestEditorPage';
import { TestsRoute } from './authoring/TestsListPage';
import { demoOutboxExtras, type DemoExtras } from './outbox/demo-extras';
import { ReportRoute } from './reports/ReportPage';
import { ResultsRoute } from './review/ResultsPage';
import { ReviewQueueRoute } from './review/ReviewQueuePage';
import { SignedInGate } from './shell/SignedIn';

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
            ...(demo === null ? [] : [demo.route]),
          ],
        },
      ],
    },
  ];
}

// The demo outbox gate (d1 spec §7.1, AT-D18): both `VITE_DEMO_OUTBOX=1` and a non-production `VITE_TRACE_ENV`
// are needed, so a production build that inherits the flag still drops the outbox. Both variables are replaced
// at build time; the condition is written inline (not through a helper) so that when it is constant-false the
// bundler drops the outbox module, its route, path, labels and the lazy import of the screen.
export const routes: RouteObject[] = buildRoutes(
  import.meta.env.VITE_DEMO_OUTBOX === '1' && import.meta.env.VITE_TRACE_ENV !== 'production'
    ? demoOutboxExtras
    : null,
);
