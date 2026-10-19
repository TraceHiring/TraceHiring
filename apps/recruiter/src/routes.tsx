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

// `VITE_DEMO_OUTBOX` is replaced at build time: when it is not '1' the condition is constant-false and the
// outbox module is dropped from the bundle.
export const routes: RouteObject[] = buildRoutes(
  import.meta.env.VITE_DEMO_OUTBOX === '1' ? demoOutboxExtras : null,
);
