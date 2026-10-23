// RED stub (tests first): replaced by the implementation.
import type { AuthoringQueueMessage } from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import type { OrgDeps } from '../tests/org-context.js';

export interface AuthoringQueue {
  send(message: AuthoringQueueMessage): Promise<void>;
}

export const createAiDraftsRoutes = (_deps: {
  org: OrgDeps;
  queue(env: Env): AuthoringQueue | null;
}): Hono<{ Bindings: Env }> => new Hono<{ Bindings: Env }>();
