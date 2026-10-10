import type { RouteObject } from 'react-router';
import { App, HealthPage, HomePage } from './App';

// Data-router route table (spec m0-foundations §3 D1). Shared by the browser entry and the tests.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'health', element: <HealthPage /> },
    ],
  },
];
