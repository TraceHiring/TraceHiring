// Item bank (spec m1 §6.2, §6.3, §4.1, §3.3, §3.5, §6.11 bank rows; M1-2, M1-3, Q23, R5-22, R5-40, R5-49 a, R5-53 c/d,
// R5-54 a, R5-55 a; E5; AT-M1-06). Every read and write goes to PostgREST as the caller: RLS decides who sees what, and
// the M1-a guards set the origin, the status of a new version, the approver and the approval time (a client never
// chooses them). The api computes the R5-49 a content hash, checks the param spec with `@trace/item-variants` (it
// refuses reserved names the contract's ParamName lets through), keeps images under the org's prefix (SEC-M1-5), and
// generates a parameterised draft's variants (§6.3, seeded by the version id, R5-52 b) before it leaves draft. Item
// review says approve or send back (`not_approved`, R5-22); the body id must equal the path id (R5-54 a). A
// library-sourced key or param spec is never shown (I-M1-5). A draft's create, edit and clone write its content and
// its key in one `save_bank_draft` call (R5-71 e). Answers are parsed by their contracts; errors are constant codes and
// never echo a stem, option or key.
import {
  ApproveItemRequest,
  BankItemCreateResponse,
  BankItemDetail,
  BankItemDraft,
  BankItemListQuery,
  BankItemListResponse,
  BankStatsResponse,
  KeyReviewItemRequest,
  type ParamSpec,
} from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import { z } from 'zod';
import { parseRows } from '../tests/authoring.js';
import { answer, parseBody, readJson, readQuery } from '../tests/http.js';
import { requireRole } from '../tests/membership.js';
import {
  eq,
  handleOrg,
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
export const BANK_KEY_REVIEW_PATH = '/v1/orgs/:orgId/bank/item-versions/:versionId/key-review';
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

/** The `save_bank_draft` payload (M1-q; the DB shape its SQL body reads). */
type DraftPayload =
  | { mode: 'create'; workspaceId: string; keyOptionId: string | null; content: DbContent }
  | {
      mode: 'update';
      itemId: string;
      versionId: string;
      keyOptionId: string | null;
      content: DbContent;
    }
  | { mode: 'clone'; itemId: string; keyOptionId: string | null; content: DbContent };

const SavedId = z.uuid();
const SavedUpdate = z.uuid().nullable();

/**
 * R5-71 e (R5-63 f, R5-64 b, A2a re-review Low 4): a draft's content and its answer key in one transaction as the
 * caller (`public.save_bank_draft`, SECURITY INVOKER: RLS and every guard apply; the guard numbers a new version and
 * sets its origin, status and workspace). A submit can no longer land between the content and the key, and a failure
 * leaves both as they were. The version id, or null when an edit matched no draft the caller can edit; any other
 * answer is 503.
 */
const saveDraft = async (
  ctx: OrgContext,
  orgId: string,
  payload: DraftPayload,
): Promise<string | null> => {
  const raw = await rpcOf(ctx.rest)('save_bank_draft', { p_org: orgId, p_payload: payload });
  const parsed = (payload.mode === 'update' ? SavedUpdate : SavedId).safeParse(raw);
  return parsed.success ? parsed.data : orgFail('unavailable');
};

/** The stored version a save answered (as the caller), for the detail answer. */
const savedVersion = async (ctx: OrgContext, orgId: string, id: string): Promise<VersionRow> =>
  (await findVersion(ctx, orgId, id)) ?? orgFail('not_found');

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

/**
 * The `GET …/bank/items` filters as PostgREST query parts (never a cursor or scope), and the extra columns of the
 * select. A pool filter is an inner embed of `pool_items` (database D3): any pool size, one read, keyset-paged.
 */
const filtersOf = (q: BankItemListQuery): { filters: Query; embed: string } => {
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
  if (q.poolId === undefined) return { filters: out, embed: '' };
  out['pool_items.pool_id'] = eq(q.poolId.toLowerCase());
  return { filters: out, embed: ',pool_items!inner(pool_id)' };
};

export const createBankRoutes = (deps: BankDeps): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();

  app.get(BANK_ITEMS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, APPROVERS);
      const q = readQuery(c.req.url, BankItemListQuery);
      const { filters, embed } = filtersOf(q);
      const rows = parseRows(
        VersionRow,
        await ctx.rest.select('item_versions', {
          select: `${VERSION_COLS}${embed}`,
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
      const id =
        (await saveDraft(ctx, orgId, {
          mode: 'create',
          workspaceId,
          keyOptionId: keyOf(draft),
          content,
        })) ?? orgFail('unavailable');
      const version = await savedVersion(ctx, orgId, id);
      return answer(BankItemCreateResponse, await detail(ctx, orgId, version), 201);
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
      const content = await contentOf(orgId, draft, deps.variants(c.env));
      // R5-64 b / Low 4: the content and the key (the contract puts it on one of this request's options; the
      // database refuses a key on no current option, 23514 → 400) are one write; the function edits only a draft
      // of this item (I-M1-3) and never the format (the item's).
      const id = await saveDraft(ctx, orgId, {
        mode: 'update',
        itemId,
        versionId: v.id,
        keyOptionId: keyOf(draft),
        content,
      });
      if (id === null) return missedUpdate(ctx, orgId, v.id);
      return answer(BankItemDetail, await detail(ctx, orgId, await savedVersion(ctx, orgId, id)));
    }),
  );

  app.post(BANK_ITEM_VERSIONS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const itemId = pathId(c.req.param('itemId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const v = (await latestVersion(ctx, orgId, itemId)) ?? orgFail('not_found');
      // One open version at a time (the database's partial unique index too: its 23505 is 409, R5-64 a); a library
      // copy is frozen content (E7: a new library version is a new copy); an AI draft a human sent back is never
      // cloned (R5-64 f). A clone of an approved or retired AI draft is a human-authored version with its own review:
      // the payload names no origin (the guard sets `human`) and the AI provenance stays on the earlier version.
      if (
        v.status === 'draft' ||
        v.status === 'in_review' ||
        v.origin === 'library' ||
        (v.origin === 'ai_draft' && v.status === 'not_approved')
      ) {
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
      // The new version and its key in one write; a second open version is the index's 23505 (409, R5-64 a).
      const id =
        (await saveDraft(ctx, orgId, { mode: 'clone', itemId, keyOptionId: key, content })) ??
        orgFail('unavailable');
      const version = await savedVersion(ctx, orgId, id);
      return answer(BankItemCreateResponse, await detail(ctx, orgId, version), 201);
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

  // R5-64 h (ABH-6, SEC-M1-4, M1-3): the library expert review. The caller records themselves as the answer-key
  // reviewer of an in-review `trace_library` version in an update of its own; the guard checks author ≠ key reviewer
  // and an active library approver, and audits `item.key_review` (R5-49 e). The reviewer is never read from the body.
  app.post(BANK_KEY_REVIEW_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const versionId = pathId(c.req.param('versionId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, APPROVERS);
      const req = parseBody(KeyReviewItemRequest, await readJson(c.req.raw));
      // R5-54 a: the body names the same version as the path.
      if (req.itemVersionId !== versionId) return orgFail('bad_request');
      // Only the library org has a key review; the path org is the caller's own (read as the caller).
      const [org] = parseRows(
        z.object({ kind: z.string() }),
        await ctx.rest.select('orgs', { select: 'kind', id: eq(orgId) }),
      );
      if (org === undefined) return orgFail('not_found');
      if (org.kind !== 'trace_library') return orgFail('conflict');
      const [row] = parseRows(
        VersionRow,
        await ctx.rest.update(
          'item_versions',
          {
            id: eq(versionId),
            org_id: eq(orgId),
            section_id: 'is.null',
            status: 'eq.in_review',
            key_reviewed_by: 'is.null',
            select: VERSION_COLS,
          },
          { key_reviewed_by: ctx.caller.userId },
        ),
      );
      const updated = row ?? (await missedUpdate(ctx, orgId, versionId));
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
