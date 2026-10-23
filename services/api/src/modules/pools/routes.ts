// RED stub (tests first): replaced by the implementation.
import { Hono } from 'hono';
import type { OrgDeps } from '../tests/org-context.js';

export const createPoolsRoutes = (_deps: { org: OrgDeps }): Hono<{ Bindings: Env }> =>
  new Hono<{ Bindings: Env }>();
