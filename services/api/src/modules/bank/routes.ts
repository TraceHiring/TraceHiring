// Item bank (spec m1 §6.2, §6.3, §4.1, §3.3, §3.5, §6.11 bank rows; M1-2, M1-3, Q23, R5-22, R5-40, R5-49 a, R5-53 c/d,
// R5-54 a, R5-55 a; E5; AT-M1-06). Every read and write goes to PostgREST as the caller: RLS decides who sees what, and
// the M1-a guards set the origin, the status of a new version, the approver and the approval time (a client never
// chooses them). The api computes the R5-49 a content hash, checks the param spec with `@trace/item-variants` (it
// refuses reserved names the contract's ParamName lets through), keeps images under the org's prefix (SEC-M1-5), and
// generates a parameterised draft's variants (§6.3, seeded by the version id, R5-52 b) before it leaves draft. Item
// review says approve or send back (`not_approved`, R5-22); the body id must equal the path id (R5-54 a). A
// library-sourced key or param spec is never shown (I-M1-5). Answers are parsed by their contracts; errors are
// constant codes and never echo a stem, option or key.
import {
  ApproveItemRequest,
  BankItemCreateResponse,
  BankItemDetail,
  BankItemDraft,
  BankItemListQuery,
  BankItemListResponse,
  BankStatsResponse,
  type ParamSpec,
} from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import { z } from 'zod';
import { inList, parseRows } from '../tests/authoring.js';
import { answer, parseBody, readJson, readQuery } from '../tests/http.js';
import { requireRole } from '../tests/membership.js';
import {
  eq,
  handleOrg,
  MAX_LIST_ROWS,
  orgFail,
  PGRST_MAX_ROWS,
  pathId,
  rpcOf,
  type OrgContext,
  type OrgDeps,
  type Query,
} from '../tests/org-context.js';
import { cursorOf, keysetQuery, pageOf } from '../tests/rest-keyset.js';
import {
  APPROVERS,
  AUTHORS,
  contentHashOf,
  defaultWorkspace,
  detailOf,
  exposureOf,
  findVersion,
  keysOf,
  latestVersion,
  mediaInOrg,
  summaryOf,
  VERSION_COLS,
  VersionRow,
  variantsForVersion,
  type VariantEngine,
} from './content.js';
import { QuantShareRow, quantShareOf } from './stats.js';

export interface BankDeps {
  org: OrgDeps;
  /** `@trace/item-variants` (§6.3), or null when unbound (a parameterised write answers 503). */
  variants(env: Env): VariantEngine | null;
}

export const BANK_ITEMS_PATH = '/v1/orgs/:orgId/bank/items';
export const BANK_ITEM_PATH = '/v1/orgs/:orgId/bank/items/:itemId';
export const BANK_ITEM_VERSIONS_PATH = '/v1/orgs/:orgId/bank/items/:itemId/versions';
export const BANK_SUBMIT_PATH = '/v1/orgs/:orgId/bank/item-versions/:versionId/submit';
export const BANK_REVIEW_PATH = '/v1/orgs/:orgId/bank/item-versions/:versionId/review';
export const BANK_RETIRE_PATH = '/v1/orgs/:orgId/bank/item-versions/:versionId/retire';
export const BANK_STATS_PATH = '/v1/orgs/:orgId/bank/stats';

/** The DB shape of a draft's content (item_versions columns; option `text` as stored, D1). */
interface DbContent {
  format: 'mcq' | 'written';
  stem: string;
  options: { id: string; text: string }[] | null;
  rubric_version_id: string | null;
  skill_key: string;
  difficulty: number;
  is_parameterised: boolean;
  param_spec: Record<string, unknown> | null;
  media: { key: string; alt: string }[] | null;
  content_sha256: string;
}

/**
 * Checks a draft body and maps it to the stored columns: images under the org's prefix, a param spec the generator
 * takes, and (parameterised) the key equal to the spec's correct option (the variants carry the keys, as an import).
 */
const contentOf = async (
  orgId: string,
  draft: BankItemDraft,
  engine: VariantEngine | null,
): Promise<DbContent> => {
  if (!mediaInOrg(draft.media, orgId)) return orgFail('bad_request');
  const media = draft.media ?? null;
  if (draft.format === 'written') {
    return {
      format: 'written',
      stem: draft.stem,
      options: null,
      rubric_version_id: draft.rubricVersionId,
      skill_key: draft.skillKey,
      difficulty: draft.difficulty,
      is_parameterised: false,
      param_spec: null,
      media,
      content_sha256: await contentHashOf({
        format: 'written',
        stem: draft.stem,
        options: null,
        media,
        paramSpec: null,
      }),
    };
  }
  const spec = draft.paramSpec;
  if (spec !== undefined) {
    if (engine === null) return orgFail('unavailable');
    if (!engine.check(spec) || spec.correctOptionId !== draft.key.optionId) {
      return orgFail('bad_request');
    }
  }
  const options = draft.options.map((o) => ({ id: o.id, text: o.text }));
  return {
    format: 'mcq',
    stem: draft.stem,
    options,
    rubric_version_id: null,
    skill_key: draft.skillKey,
    difficulty: draft.difficulty,
    is_parameterised: spec !== undefined,
    param_spec: spec ?? null,
    media,
    content_sha256: await contentHashOf({
      format: 'mcq',
      stem: draft.stem,
      options,
      media,
      paramSpec: spec ?? null,
    }),
  };
};

/** The item key a draft stores: an mcq that is not parameterised has one; the others none. */
const keyOf = (draft: BankItemDraft): string | null =>
  draft.format === 'mcq' && draft.paramSpec === undefined ? draft.key.optionId : null;

/** The detail of one stored version, with its readable key and its item's exposure. */
const detail = async (ctx: OrgContext, orgId: string, v: VersionRow) => {
  const keys = v.format === 'mcq' ? await keysOf(ctx, orgId, [v.id]) : new Map<string, string>();
  const exposure = await exposureOf(ctx, orgId, [v.item_id]);
  return detailOf(v, keys.get(v.id), exposure.get(v.item_id) ?? 0);
};

/** Best-effort undo of a create whose later step failed (draft rows are deletable; the answer stands). */
const undo = async (ctx: OrgContext, orgId: string, made: { item?: string; version?: string }) => {
  for (const [table, id] of [
    ['item_answer_keys', made.version],
    ['item_versions', made.version],
    ['items', made.item],
  ] as const) {
    if (id === undefined) continue;
    try {
      await ctx.rest.remove(
        table,
        table === 'item_answer_keys'
          ? { item_version_id: eq(id), org_id: eq(orgId) }
          : { id: eq(id), org_id: eq(orgId) },
      );
    } catch {
      // The original failure is answered; an empty draft item is harmless.
    }
  }
};

/** Inserts a draft version of `itemId` (the guard numbers it and sets origin, status and workspace). */
const insertVersion = async (
  ctx: OrgContext,
  orgId: string,
  itemId: string,
  content: DbContent,
): Promise<VersionRow> => {
  const [row] = parseRows(
    VersionRow,
    await ctx.rest.insert(
      'item_versions',
      { org_id: orgId, item_id: itemId, ...content },
      { select: VERSION_COLS },
    ),
  );
  return row ?? orgFail('not_found');
};

const insertKey = async (ctx: OrgContext, orgId: string, versionId: string, optionId: string) => {
  await ctx.rest.insert(
    'item_answer_keys',
    { org_id: orgId, item_version_id: versionId, format: 'mcq', key: { option_id: optionId } },
    { select: 'item_version_id' },
  );
};

/** After a guarded status update matched no row: 404 when the caller cannot see the version, else 409. */
const missedUpdate = async (ctx: OrgContext, orgId: string, versionId: string): Promise<never> =>
  orgFail((await findVersion(ctx, orgId, versionId)) === null ? 'not_found' : 'conflict');

const setStatus = async (
  ctx: OrgContext,
  orgId: string,
  versionId: string,
  from: string,
  to: string,
): Promise<VersionRow> => {
  const [row] = parseRows(
    VersionRow,
    await ctx.rest.update(
      'item_versions',
      {
        id: eq(versionId),
        org_id: eq(orgId),
        section_id: 'is.null',
        status: eq(from),
        select: VERSION_COLS,
      },
      { status: to },
    ),
  );
  return row ?? missedUpdate(ctx, orgId, versionId);
};

/** The `GET …/bank/items` filters as PostgREST query parts (never a cursor or scope). */
const filtersOf = async (
  ctx: OrgContext,
  orgId: string,
  q: BankItemListQuery,
): Promise<Query | null> => {
  const out: Record<string, string> = {};
  if (q.format !== undefined) out.format = eq(q.format);
  if (q.skillKey !== undefined) out.skill_key = eq(q.skillKey);
  if (q.status !== undefined) out.status = eq(q.status);
  if (q.origin !== undefined) out.origin = eq(q.origin);
  if (q.difficultyMin !== undefined && q.difficultyMax !== undefined) {
    out.and = `(difficulty.gte.${String(q.difficultyMin)},difficulty.lte.${String(q.difficultyMax)})`;
  } else if (q.difficultyMin !== undefined) {
    out.difficulty = `gte.${String(q.difficultyMin)}`;
  } else if (q.difficultyMax !== undefined) {
    out.difficulty = `lte.${String(q.difficultyMax)}`;
  }
  if (q.poolId !== undefined) {
    const rows = parseRows(
      z.object({ item_version_id: z.uuid() }),
      await ctx.rest.select('pool_items', {
        select: 'item_version_id',
        org_id: eq(orgId),
        pool_id: eq(q.poolId),
        limit: String(MAX_LIST_ROWS + 1),
      }),
    );
    // A pool filter is one `in.(…)` list; past MAX_LIST_ROWS it fails closed rather than cut the list.
    if (rows.length > MAX_LIST_ROWS) return orgFail('unavailable');
    if (rows.length === 0) return null;
    out.id = inList(rows.map((r) => r.item_version_id));
  }
  return out;
};

export const createBankRoutes = (deps: BankDeps): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();

  app.get(BANK_ITEMS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, APPROVERS);
      const q = readQuery(c.req.url, BankItemListQuery);
      const filters = await filtersOf(ctx, orgId, q);
      if (filters === null) return answer(BankItemListResponse, { items: [], nextCursor: null });
      const rows = parseRows(
        VersionRow,
        await ctx.rest.select('item_versions', {
          select: VERSION_COLS,
          org_id: eq(orgId),
          section_id: 'is.null',
          ...filters,
          ...keysetQuery(cursorOf(q.cursor), 'desc'),
        }),
      );
      const page = pageOf(rows);
      const exposure = await exposureOf(
        ctx,
        orgId,
        page.rows.map((r) => r.item_id),
      );
      return answer(BankItemListResponse, {
        items: page.rows.map((r) => summaryOf(r, exposure.get(r.item_id) ?? 0)),
        nextCursor: page.nextCursor,
      });
    }),
  );

  app.post(BANK_ITEMS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const draft = parseBody(BankItemDraft, await readJson(c.req.raw));
      const content = await contentOf(orgId, draft, deps.variants(c.env));
      const workspaceId = draft.workspaceId ?? (await defaultWorkspace(ctx, orgId));
      const [item] = parseRows(
        z.object({ id: z.uuid() }),
        await ctx.rest.insert(
          'items',
          {
            org_id: orgId,
            workspace_id: workspaceId,
            format: draft.format,
            skill_key: draft.skillKey,
          },
          { select: 'id' },
        ),
      );
      if (item === undefined) return orgFail('not_found');
      const made: { item?: string; version?: string } = { item: item.id };
      try {
        const version = await insertVersion(ctx, orgId, item.id, content);
        made.version = version.id;
        const key = keyOf(draft);
        if (key !== null) await insertKey(ctx, orgId, version.id, key);
        return answer(BankItemCreateResponse, await detail(ctx, orgId, version), 201);
      } catch (err) {
        await undo(ctx, orgId, made);
        throw err;
      }
    }),
  );

  app.get(BANK_ITEM_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const itemId = pathId(c.req.param('itemId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, APPROVERS);
      const v = (await latestVersion(ctx, orgId, itemId)) ?? orgFail('not_found');
      return answer(BankItemDetail, await detail(ctx, orgId, v));
    }),
  );

  app.put(BANK_ITEM_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const itemId = pathId(c.req.param('itemId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const draft = parseBody(BankItemDraft, await readJson(c.req.raw));
      const v = (await latestVersion(ctx, orgId, itemId)) ?? orgFail('not_found');
      // The format and the workspace of an item never change (items guard); an edit names neither.
      if (draft.format !== v.format || draft.workspaceId !== undefined) {
        return orgFail('bad_request');
      }
      // I-M1-3: only a draft is edited; anything else is a new version (POST …/versions).
      if (v.status !== 'draft') return orgFail('conflict');
      // The format is the item's and never changes; the update carries the content columns only.
      const patch: Partial<DbContent> = await contentOf(orgId, draft, deps.variants(c.env));
      delete patch.format;
      const [updated] = parseRows(
        VersionRow,
        await ctx.rest.update(
          'item_versions',
          { id: eq(v.id), org_id: eq(orgId), status: 'eq.draft', select: VERSION_COLS },
          patch,
        ),
      );
      if (updated === undefined) return missedUpdate(ctx, orgId, v.id);
      const key = keyOf(draft);
      if (key === null) {
        await ctx.rest.remove('item_answer_keys', {
          item_version_id: eq(v.id),
          org_id: eq(orgId),
        });
      } else {
        const [changed] = await ctx.rest.update(
          'item_answer_keys',
          { item_version_id: eq(v.id), org_id: eq(orgId), select: 'item_version_id' },
          { key: { option_id: key } },
        );
        if (changed === undefined) await insertKey(ctx, orgId, v.id, key);
      }
      return answer(BankItemDetail, await detail(ctx, orgId, updated));
    }),
  );

  app.post(BANK_ITEM_VERSIONS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const itemId = pathId(c.req.param('itemId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const v = (await latestVersion(ctx, orgId, itemId)) ?? orgFail('not_found');
      // One open version at a time; a library copy is frozen content (E7: a new library version is a new copy).
      if (v.status === 'draft' || v.status === 'in_review' || v.origin === 'library') {
        return orgFail('conflict');
      }
      const key =
        v.format === 'mcq' && !v.is_parameterised
          ? ((await keysOf(ctx, orgId, [v.id])).get(v.id) ?? orgFail('conflict'))
          : null;
      const content: DbContent = {
        format: v.format,
        stem: v.stem,
        options: v.options,
        rubric_version_id: v.rubric_version_id,
        skill_key: v.skill_key ?? orgFail('conflict'),
        difficulty: v.difficulty ?? orgFail('conflict'),
        is_parameterised: v.is_parameterised,
        param_spec: v.param_spec,
        media: v.media,
        content_sha256: await contentHashOf({
          format: v.format,
          stem: v.stem,
          options: v.options,
          media: v.media,
          paramSpec: v.param_spec,
        }),
      };
      const made: { version?: string } = {};
      try {
        const version = await insertVersion(ctx, orgId, itemId, content);
        made.version = version.id;
        if (key !== null) await insertKey(ctx, orgId, version.id, key);
        return answer(BankItemCreateResponse, await detail(ctx, orgId, version), 201);
      } catch (err) {
        await undo(ctx, orgId, made);
        throw err;
      }
    }),
  );

  app.post(BANK_SUBMIT_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const versionId = pathId(c.req.param('versionId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const v = (await findVersion(ctx, orgId, versionId)) ?? orgFail('not_found');
      if (v.status !== 'draft') return orgFail('conflict');
      if (v.is_parameterised) {
        // §6.3: the variants are generated and stored before the version leaves draft (the guard checks them).
        const engine = deps.variants(c.env) ?? orgFail('unavailable');
        const spec = v.param_spec;
        const variants =
          spec === null || v.difficulty === null || !engine.check(spec)
            ? null
            : await variantsForVersion(engine, spec as unknown as ParamSpec, v.id, v.difficulty);
        if (variants === null) return orgFail('draft_incomplete');
        await rpcOf(ctx.rest)('save_item_variants', {
          p_item_version: v.id,
          p_variants: variants,
        });
      }
      const updated = await setStatus(ctx, orgId, versionId, 'draft', 'in_review');
      return answer(BankItemDetail, await detail(ctx, orgId, updated));
    }),
  );

  app.post(BANK_REVIEW_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const versionId = pathId(c.req.param('versionId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, APPROVERS);
      const req = parseBody(ApproveItemRequest, await readJson(c.req.raw));
      // R5-54 a: the body names the same version as the path.
      if (req.itemVersionId !== versionId) return orgFail('bad_request');
      const updated = await setStatus(
        ctx,
        orgId,
        versionId,
        'in_review',
        req.decision === 'approve' ? 'approved' : 'not_approved',
      );
      return answer(BankItemDetail, await detail(ctx, orgId, updated));
    }),
  );

  app.post(BANK_RETIRE_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const versionId = pathId(c.req.param('versionId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const updated = await setStatus(ctx, orgId, versionId, 'approved', 'retired');
      return answer(BankItemDetail, await detail(ctx, orgId, updated));
    }),
  );

  app.get(BANK_STATS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const rows = parseRows(
        QuantShareRow,
        await ctx.rest.select('v_item_bank_quant_share', {
          select: 'quant_items_approved,quant_items_parameterised',
          org_id: eq(orgId),
          limit: String(PGRST_MAX_ROWS),
        }),
      );
      // One row per workspace; a read that may have been cut fails closed.
      if (rows.length >= PGRST_MAX_ROWS) return orgFail('unavailable');
      return answer(BankStatsResponse, { org: quantShareOf(rows), library: null });
    }),
  );

  return app;
};
