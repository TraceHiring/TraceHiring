// RED stub (tests first): replaced by the implementation.
import { Hono } from 'hono';
import type { OrgDeps } from '../tests/org-context.js';
import type { ItemMediaStore } from './media.js';

export const createImportsRoutes = (_deps: {
  org: OrgDeps;
  media(env: Env): ItemMediaStore | null;
}): Hono<{ Bindings: Env }> => new Hono<{ Bindings: Env }>();
