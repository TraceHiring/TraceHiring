// RED stub (tests first): replaced by the implementation.
import { Hono } from 'hono';
import type { LibraryLimiter } from '../templates/routes.js';
import type { OrgDeps } from '../tests/org-context.js';
import type { LibrarySource } from './source.js';

export const createLibraryRoutes = (_deps: {
  org: OrgDeps;
  source(env: Env): LibrarySource | null;
  limiter(env: Env): LibraryLimiter | null;
}): Hono<{ Bindings: Env }> => new Hono<{ Bindings: Env }>();
