// Pools (spec m1 §3.2 pools/pool_items, §3.5, §6.2 pools editor, §6.5, §6.11 `GET/POST/PUT …/pools`,
// `POST/DELETE …/pools/:id/items`; R2-9, R5-54 a, R5-55 a; E3, E4). A pool is a working set of approved bank items of one
// format in one workspace (the pool_items guard checks both); what a test serves is frozen in section_pool_snapshot at
// publish, so editing a pool never changes a published test. Every read and write is the caller's (RLS decides).
// PoolDetail counts the items and the approved ones (a retired item stays in the pool and stops counting, E3) and names
// the tests whose sections draw from the pool, with their largest draw (the editor shows the size against 10x the draw).
// Adding an item already in the pool is a no-op; ids are checked as a batch of distinct uuids (PoolItemsRequest).
import {
  PoolDetail,
  PoolItemsRequest,
  PoolListQuery,
  PoolListResponse,
  PoolRequest,
} from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import { z } from 'zod';
import { defaultWorkspace, AUTHORS } from '../bank/content.js';
import { inList, parseRows } from '../tests/authoring.js';
import { answer, parseBody, readJson, readQuery } from '../tests/http.js';
import { requireRole } from '../tests/membership.js';
import {
  chunks,
  eq,
  handleOrg,
  orgFail,
  PGRST_MAX_ROWS,
  pathId,
  type OrgContext,
  type OrgDeps,
} from '../tests/org-context.js';
import { cursorOf, keysetQuery, pageOf } from '../tests/rest-keyset.js';

export interface PoolsDeps {
  org: OrgDeps;
}

export const POOLS_PATH = '/v1/orgs/:orgId/pools';
export const POOL_PATH = '/v1/orgs/:orgId/pools/:poolId';
export const POOL_ITEMS_PATH = '/v1/orgs/:orgId/pools/:poolId/items';

const POOL_COLS = 'id,name,format,skill_key,status,workspace_id,created_at';
const PoolRow = z.object({
  id: z.uuid(),
  name: z.string(),
  format: z.enum(['mcq', 'written']),
  skill_key: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  workspace_id: z.uuid(),
  created_at: z.string(),
});
type PoolRow = z.infer<typeof PoolRow>;

/** A package holds at most 5,000 items; the pools one page reads hold at most this many members in all. */
const MAX_MEMBERS = 10_000;
/** PoolDetail lists at most this many drawing tests (usedByDrawsTotal counts all of them). */
const MAX_DRAWS_LISTED = 50;

const MemberRow = z.object({ pool_id: z.uuid(), item_version_id: z.uuid() });
const SectionRow = z.object({
  pool_id: z.uuid(),
  test_id: z.uuid(),
  draw_count: z.coerce.number().int().min(1),
});

/** Every member of these pools, read in keyset pages of PostgREST's max_rows (never a silently cut list). */
const membersOf = async (
  ctx: OrgContext,
  orgId: string,
  poolIds: readonly string[],
): Promise<z.infer<typeof MemberRow>[]> => {
  const out: z.infer<typeof MemberRow>[] = [];
  for (const part of chunks(poolIds)) {
    let after: { pool: string; item: string } | null = null;
    for (;;) {
      const rows = parseRows(
        MemberRow,
        await ctx.rest.select('pool_items', {
          select: 'pool_id,item_version_id',
          org_id: eq(orgId),
          pool_id: inList(part),
          order: 'pool_id.asc,item_version_id.asc',
          limit: String(PGRST_MAX_ROWS),
          ...(after === null
            ? {}
            : {
                or: `(pool_id.gt.${after.pool},and(pool_id.eq.${after.pool},item_version_id.gt.${after.item}))`,
              }),
        }),
      );
      out.push(...rows);
      if (out.length > MAX_MEMBERS) return orgFail('unavailable');
      const last = rows[rows.length - 1];
      if (rows.length < PGRST_MAX_ROWS || last === undefined) break;
      after = { pool: last.pool_id, item: last.item_version_id };
    }
  }
  return out;
};

/** The approved ones among these item versions. */
const approvedOf = async (
  ctx: OrgContext,
  orgId: string,
  versionIds: readonly string[],
): Promise<Set<string>> => {
  const out = new Set<string>();
  for (const part of chunks(versionIds)) {
    const rows = parseRows(
      z.object({ id: z.uuid() }),
      await ctx.rest.select('item_versions', {
        select: 'id',
        org_id: eq(orgId),
        id: inList(part),
        status: 'eq.approved',
      }),
    );
    for (const r of rows) out.add(r.id);
  }
  return out;
};

/** The sections that draw from these pools (any test version the caller can read). */
const drawsOf = async (
  ctx: OrgContext,
  orgId: string,
  poolIds: readonly string[],
): Promise<z.infer<typeof SectionRow>[]> => {
  const out: z.infer<typeof SectionRow>[] = [];
  for (const part of chunks(poolIds)) {
    const rows = parseRows(
      SectionRow,
      await ctx.rest.select('sections', {
        select: 'pool_id,test_id,draw_count',
        org_id: eq(orgId),
        pool_id: inList(part),
        limit: String(PGRST_MAX_ROWS),
      }),
    );
    if (rows.length >= PGRST_MAX_ROWS) return orgFail('unavailable');
    out.push(...rows);
  }
  return out;
};

/** PoolDetail of each pool row, in order. */
const detailsOf = async (
  ctx: OrgContext,
  orgId: string,
  pools: readonly PoolRow[],
): Promise<PoolDetail[]> => {
  const ids = pools.map((p) => p.id);
  const members = ids.length === 0 ? [] : await membersOf(ctx, orgId, ids);
  const approved = await approvedOf(
    ctx,
    orgId,
    members.map((m) => m.item_version_id),
  );
  const sections = ids.length === 0 ? [] : await drawsOf(ctx, orgId, ids);
  return pools.map((p) => {
    const mine = members.filter((m) => m.pool_id === p.id);
    const byTest = new Map<string, number>();
    for (const s of sections) {
      if (s.pool_id !== p.id) continue;
      byTest.set(s.test_id, Math.max(byTest.get(s.test_id) ?? 0, s.draw_count));
    }
    const draws = [...byTest.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([testId, drawCount]) => ({ testId, drawCount }));
    return {
      id: p.id,
      name: p.name,
      format: p.format,
      skillKey: p.skill_key,
      status: p.status,
      itemCount: mine.length,
      approvedCount: mine.filter((m) => approved.has(m.item_version_id)).length,
      usedByDraws: draws.slice(0, MAX_DRAWS_LISTED),
      usedByDrawsTotal: draws.length,
    };
  });
};

const findPool = async (ctx: OrgContext, orgId: string, poolId: string): Promise<PoolRow> => {
  const [row] = parseRows(
    PoolRow,
    await ctx.rest.select('pools', { select: POOL_COLS, id: eq(poolId), org_id: eq(orgId) }),
  );
  return row ?? orgFail('not_found');
};

const detailOf = async (ctx: OrgContext, orgId: string, pool: PoolRow): Promise<PoolDetail> => {
  const [detail] = await detailsOf(ctx, orgId, [pool]);
  return detail ?? orgFail('unavailable');
};

export const createPoolsRoutes = (deps: PoolsDeps): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();

  app.get(POOLS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const query = readQuery(c.req.url, PoolListQuery);
      const page = pageOf(
        parseRows(
          PoolRow,
          await ctx.rest.select('pools', {
            select: POOL_COLS,
            org_id: eq(orgId),
            ...keysetQuery(cursorOf(query.cursor), 'desc'),
          }),
        ),
      );
      return answer(PoolListResponse, {
        pools: await detailsOf(ctx, orgId, page.rows),
        nextCursor: page.nextCursor,
      });
    }),
  );

  app.post(POOLS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const req = parseBody(PoolRequest, await readJson(c.req.raw));
      const workspaceId = req.workspaceId ?? (await defaultWorkspace(ctx, orgId));
      const [row] = parseRows(
        PoolRow,
        await ctx.rest.insert(
          'pools',
          {
            org_id: orgId,
            workspace_id: workspaceId,
            name: req.name,
            format: req.format,
            skill_key: req.skillKey ?? null,
          },
          { select: POOL_COLS },
        ),
      );
      if (row === undefined) return orgFail('not_found');
      return answer(PoolDetail, await detailOf(ctx, orgId, row), 201);
    }),
  );

  app.get(POOL_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const poolId = pathId(c.req.param('poolId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      return answer(PoolDetail, await detailOf(ctx, orgId, await findPool(ctx, orgId, poolId)));
    }),
  );

  app.put(POOL_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const poolId = pathId(c.req.param('poolId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const req = parseBody(PoolRequest, await readJson(c.req.raw));
      const pool = await findPool(ctx, orgId, poolId);
      // The format and the workspace of a pool never change (pools guard).
      if (req.format !== pool.format) return orgFail('bad_request');
      if (req.workspaceId !== undefined && req.workspaceId !== pool.workspace_id) {
        return orgFail('bad_request');
      }
      const [row] = parseRows(
        PoolRow,
        await ctx.rest.update(
          'pools',
          { id: eq(poolId), org_id: eq(orgId), select: POOL_COLS },
          { name: req.name, skill_key: req.skillKey ?? null },
        ),
      );
      if (row === undefined) return orgFail('not_found');
      return answer(PoolDetail, await detailOf(ctx, orgId, row));
    }),
  );

  app.post(POOL_ITEMS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const poolId = pathId(c.req.param('poolId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const req = parseBody(PoolItemsRequest, await readJson(c.req.raw));
      const pool = await findPool(ctx, orgId, poolId);
      const present = new Set(
        (await membersOf(ctx, orgId, [pool.id])).map((m) => m.item_version_id),
      );
      const fresh = req.itemVersionIds.filter((id) => !present.has(id));
      if (fresh.length > 0) {
        // One statement: the guard checks each (approved, same org and format, pool active) and all or none land.
        await ctx.rest.insert(
          'pool_items',
          fresh.map((id) => ({ org_id: orgId, pool_id: pool.id, item_version_id: id })),
          { select: 'item_version_id' },
        );
      }
      return answer(PoolDetail, await detailOf(ctx, orgId, pool));
    }),
  );

  app.delete(POOL_ITEMS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const poolId = pathId(c.req.param('poolId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const req = parseBody(PoolItemsRequest, await readJson(c.req.raw));
      const pool = await findPool(ctx, orgId, poolId);
      for (const part of chunks(req.itemVersionIds)) {
        await ctx.rest.remove('pool_items', {
          org_id: eq(orgId),
          pool_id: eq(pool.id),
          item_version_id: inList(part),
          select: 'item_version_id',
        });
      }
      return answer(PoolDetail, await detailOf(ctx, orgId, pool));
    }),
  );

  return app;
};
