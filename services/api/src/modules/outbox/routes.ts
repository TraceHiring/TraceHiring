// GET /v1/orgs/:orgId/demo-outbox (spec §6.1 /demo-outbox, §6.2 last row; D1-2, L-11; AT-D18 api half). The demo
// outbox exists only on `dev` and `staging` with DEMO_OUTBOX on: anywhere else (production, a missing or empty
// TRACE_ENV, the switch off) the route answers the generic 404 before it even reads the token, so it looks like no
// route at all. Readers: owner, admin and recruiter of the path org (their own membership, read under RLS); the DO
// is per org and is addressed only by the path org after that check. Entries carry no recipient address.
import { OutboxListResponse } from '@trace/shared/contracts/d1';
import { Hono } from 'hono';
import { requireRole } from '../tests/membership.js';
import { eq, handleOrg, orgFail, orgJson, pathId, type OrgDeps } from '../tests/org-context.js';
import {
  createDemoOutbox,
  demoOutboxEnabled,
  outboxNamespace,
  type OutboxReader,
} from './outbox-writer.js';

export const DEMO_OUTBOX_PATH = '/v1/orgs/:orgId/demo-outbox';

export interface OutboxRouteDeps {
  org: OrgDeps;
  /** The per-org outbox reader, or null when the OUTBOX binding is missing. */
  reader(env: Env): OutboxReader | null;
}

export const outboxReaderFromEnv = (env: Env): OutboxReader | null =>
  createDemoOutbox(env, outboxNamespace(env));

/** The sub-router the lead mounts with `app.route('/', createOutboxRoutes({ org, reader: outboxReaderFromEnv }))`. */
export const createOutboxRoutes = (deps: OutboxRouteDeps): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();

  app.get(DEMO_OUTBOX_PATH, (c) =>
    handleOrg(async () => {
      // L-11: not on production, and not on any environment that does not name itself dev or staging.
      if (!demoOutboxEnabled(c.env)) return orgFail('not_found');
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, ['org_owner', 'admin', 'recruiter']);
      // DB review r3 m-2: the own-membership read above works in any org state, and nothing under RLS follows
      // (the DO is read directly), so the org row must be visible to the caller: `orgs_select_member` ->
      // `my_org_ids()` hides a suspended org.
      const visible = await ctx.rest.select('orgs', { select: 'id', org_id: eq(orgId) });
      if (visible.length !== 1) return orgFail('not_found');
      const reader = deps.reader(c.env) ?? orgFail('unavailable');
      let entries: unknown;
      try {
        entries = await reader.list(orgId);
      } catch {
        return orgFail('unavailable');
      }
      const out = OutboxListResponse.safeParse({ entries });
      return out.success ? orgJson(out.data) : orgFail('unavailable');
    }),
  );

  return app;
};
