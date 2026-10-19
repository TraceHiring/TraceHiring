// Everything about the demo outbox that routes.tsx needs, in one module that only non-production builds import
// (VITE_DEMO_OUTBOX=1). A production build never references this module, so it is tree-shaken away together with
// the screen, its path and its labels (AT-D18; scripts/check-no-demo-outbox.mjs looks for them in dist/).
import type { RouteObject } from 'react-router';
import type { NavItem } from '../shell/nav';

export interface DemoExtras {
  route: RouteObject;
  nav: NavItem;
}

export const demoOutboxExtras: DemoExtras = {
  route: {
    path: 'demo-outbox',
    lazy: async () => {
      const page = await import('./OutboxPage');
      return { Component: page.default };
    },
  },
  nav: { to: '/demo-outbox', label: 'Demo outbox' },
};
