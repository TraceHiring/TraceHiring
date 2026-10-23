// Shared bank helpers (spec m1 §3.3 item_versions, §5 BankItemDetail/Summary, §6.3, R5-49 a, R5-52 b, SEC-M1-5): the
// stored version shape and its views, the R5-49 a content hash, the image-prefix check, the default workspace, and the
// variant rows a parameterised version stores through `public.save_item_variants` (also used by imports). Every read
// goes through the caller's PostgREST client (RLS decides); a row that does not fit is 503 `unavailable`.
import type { BankItemDetail, BankItemSummary, ParamSpec } from '@trace/shared/contracts/m1';
import { itemContentSha256, variantContentSha256 } from '@trace/shared/item-hash';
import { z } from 'zod';
import { inList, parseRows } from '../tests/authoring.js';
import type { Role } from '../tests/membership.js';
import { chunks, eq, orgFail, type OrgContext } from '../tests/org-context.js';

/** Bank authors (§3.5: owner, admin, recruiter in their workspaces). */
export const AUTHORS: readonly Role[] = ['org_owner', 'admin', 'recruiter'];
/** Bank readers and approvers (§2, M1-3, R5-40: reviewers read and approve in their workspace). */
export const APPROVERS: readonly Role[] = ['org_owner', 'admin', 'recruiter', 'reviewer'];

export const VERSION_COLS =
  'id,item_id,version_no,workspace_id,format,stem,options,rubric_version_id,skill_key,difficulty,status,' +
  'origin,is_parameterised,param_spec,media,created_by,approved_by,approved_at,created_at';

const Num = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v))
  .pipe(z.number().finite());

export const VersionRow = z.object({
  id: z.uuid(),
  item_id: z.uuid(),
  version_no: z.coerce.number().int(),
  workspace_id: z.uuid(),
  format: z.enum(['mcq', 'written']),
  stem: z.string(),
  options: z.array(z.object({ id: z.string(), text: z.string() })).nullable(),
  rubric_version_id: z.uuid().nullable(),
  skill_key: z.string().nullable(),
  difficulty: Num.nullable(),
  status: z.string(),
  origin: z.string(),
  is_parameterised: z.boolean(),
  param_spec: z.record(z.string(), z.unknown()).nullable(),
  media: z.array(z.object({ key: z.string(), alt: z.string() })).nullable(),
  created_by: z.uuid().nullable(),
  approved_by: z.uuid().nullable(),
  approved_at: z.string().nullable(),
  created_at: z.string(),
});
export type VersionRow = z.infer<typeof VersionRow>;

/** item_answer_keys.key `{option_id}` (D1). Library-sourced keys are invisible to every org role (I-M1-5). */
const KeyRow = z.object({ item_version_id: z.uuid(), key: z.object({ option_id: z.string() }) });
const ExposureRow = z.object({ item_id: z.uuid(), served_count: Num });

/** The org's default workspace (as D1's CreateTestRequest); 404 when the caller cannot see it. */
export const defaultWorkspace = async (ctx: OrgContext, orgId: string): Promise<string> => {
  const [ws] = parseRows(
    z.object({ id: z.uuid() }),
    await ctx.rest.select('workspaces', {
      select: 'id',
      org_id: eq(orgId),
      is_default: 'eq.true',
    }),
  );
  return ws?.id ?? orgFail('not_found');
};

/** SEC-M1-5: an image an org user writes lies under the org's own prefix (the guard refuses it too). */
export const mediaInOrg = (media: readonly { key: string }[] | undefined, orgId: string): boolean =>
  (media ?? []).every((m) => m.key.startsWith(`item-media/${orgId}/`));

/** The R5-49 a content hash of a version's served content (never a key; the spec without correctOptionId). */
export const contentHashOf = (content: {
  format: 'mcq' | 'written';
  stem: string;
  options: readonly { id: string; text: string }[] | null;
  media: readonly { key: string; alt: string }[] | null;
  paramSpec: Readonly<Record<string, unknown>> | null;
}): Promise<string> =>
  itemContentSha256({
    format: content.format,
    stem: content.stem,
    options: content.options,
    media: content.media === null || content.media.length === 0 ? null : content.media,
    paramSpec: content.paramSpec,
  });

/**
 * The variant engine (`@trace/item-variants`, §6.3): `check` is `validateParamSpec(spec).ok` (it refuses reserved names
 * the contract's ParamName lets through) and `generate` is `generateVariants`. Injected: the api's Workers tsconfig cannot
 * type-check that package yet (Lead ask), so the lead binds it at the mount; unbound, a parameterised write is 503.
 */
export interface VariantEngine {
  check(spec: unknown): boolean;
  generate(
    spec: ParamSpec,
    seeds: readonly Uint8Array[],
  ):
    | {
        readonly ok: true;
        readonly variants: readonly {
          readonly variantNo: number;
          readonly params: Readonly<Record<string, number | string>>;
          readonly stem: string;
          readonly options: readonly { readonly id: string; readonly text: string }[];
          readonly correctOptionId: string;
        }[];
      }
    | { readonly ok: false };
}

/** One row of `public.save_item_variants` / `import_item_batch` `variants` (M1-c). */
export interface VariantRow {
  variantNo: number;
  params: Readonly<Record<string, number | string>>;
  stem: string;
  options: readonly { id: string; text: string }[];
  difficulty: number;
  contentSha256: string;
  correctOptionId: string;
}

const sha256Bytes = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

/** The stored variant rows (difficulty = the parent's, §6.3), or null when generation failed. */
const variantRowsOf = async (
  engine: VariantEngine,
  spec: ParamSpec,
  seeds: readonly Uint8Array[],
  difficulty: number,
): Promise<VariantRow[] | null> => {
  const result = engine.generate(spec, seeds);
  if (!result.ok) return null;
  return Promise.all(
    result.variants.map(async (v) => ({
      variantNo: v.variantNo,
      params: v.params,
      stem: v.stem,
      options: v.options.map((o) => ({ id: o.id, text: o.text })),
      difficulty,
      contentSha256: await variantContentSha256({
        stem: v.stem,
        options: v.options,
        params: v.params,
      }),
      correctOptionId: v.correctOptionId,
    })),
  );
};

/** §6.3, R5-52 b: the variants of a bank version, variant k seeded by SHA-256(utf8(versionId) ‖ utf8(k)). */
export const variantsForVersion = async (
  engine: VariantEngine,
  spec: ParamSpec,
  versionId: string,
  difficulty: number,
): Promise<VariantRow[] | null> => {
  const seeds = await Promise.all(
    Array.from({ length: spec.count }, (_, k) => sha256Bytes(`${versionId}${String(k + 1)}`)),
  );
  return variantRowsOf(engine, spec, seeds, difficulty);
};

/**
 * The variants of an import row. The version id does not exist before `import_item_batch` inserts it, so variant k is
 * seeded by SHA-256(utf8(`import:<jobId>:<rowNo>:<k>`)) (deterministic, replayable; Choice reported to the lead).
 */
export const variantsForImportRow = async (
  engine: VariantEngine,
  spec: ParamSpec,
  jobId: string,
  rowNo: number,
  difficulty: number,
): Promise<VariantRow[] | null> => {
  const seeds = await Promise.all(
    Array.from({ length: spec.count }, (_, k) =>
      sha256Bytes(`import:${jobId}:${String(rowNo)}:${String(k + 1)}`),
    ),
  );
  return variantRowsOf(engine, spec, seeds, difficulty);
};

/** Exposure counts by item id (v_item_exposure, M1-6), summed over workspaces. */
export const exposureOf = async (
  ctx: OrgContext,
  orgId: string,
  itemIds: readonly string[],
): Promise<Map<string, number>> => {
  const out = new Map<string, number>();
  for (const part of chunks(itemIds)) {
    const rows = parseRows(
      ExposureRow,
      await ctx.rest.select('v_item_exposure', {
        select: 'item_id,served_count',
        org_id: eq(orgId),
        item_id: inList(part),
      }),
    );
    for (const r of rows) out.set(r.item_id, (out.get(r.item_id) ?? 0) + r.served_count);
  }
  return out;
};

/** The readable keys of these versions (RLS hides library-sourced keys). */
export const keysOf = async (
  ctx: OrgContext,
  orgId: string,
  versionIds: readonly string[],
): Promise<Map<string, string>> => {
  const out = new Map<string, string>();
  for (const part of chunks(versionIds)) {
    const rows = parseRows(
      KeyRow,
      await ctx.rest.select('item_answer_keys', {
        select: 'item_version_id,key',
        org_id: eq(orgId),
        item_version_id: inList(part),
      }),
    );
    for (const r of rows) out.set(r.item_version_id, r.key.option_id);
  }
  return out;
};

/** One bank version by id (section_id null), or null when the caller cannot see it. */
export const findVersion = async (
  ctx: OrgContext,
  orgId: string,
  versionId: string,
): Promise<VersionRow | null> => {
  const [row] = parseRows(
    VersionRow,
    await ctx.rest.select('item_versions', {
      select: VERSION_COLS,
      id: eq(versionId),
      org_id: eq(orgId),
      section_id: 'is.null',
    }),
  );
  return row ?? null;
};

/** The latest bank version of an item, or null. */
export const latestVersion = async (
  ctx: OrgContext,
  orgId: string,
  itemId: string,
): Promise<VersionRow | null> => {
  const [row] = parseRows(
    VersionRow,
    await ctx.rest.select('item_versions', {
      select: VERSION_COLS,
      item_id: eq(itemId),
      org_id: eq(orgId),
      section_id: 'is.null',
      order: 'version_no.desc',
      limit: '1',
    }),
  );
  return row ?? null;
};

/** BankItemDetail of a stored version (the answer is still parsed by its contract before it leaves). */
export const detailOf = (
  v: VersionRow,
  key: string | undefined,
  exposure: number,
): BankItemDetail => {
  const librarySourced = v.origin === 'library';
  const media = v.media === null || v.media.length === 0 ? undefined : v.media;
  const content =
    v.format === 'mcq'
      ? {
          format: 'mcq' as const,
          stem: v.stem,
          options: v.options ?? [],
          ...(librarySourced
            ? {}
            : (() => {
                const spec = v.param_spec;
                const optionId =
                  key ??
                  (spec !== null && typeof spec.correctOptionId === 'string'
                    ? spec.correctOptionId
                    : undefined);
                return {
                  ...(optionId === undefined ? {} : { key: { optionId } }),
                  ...(spec === null ? {} : { paramSpec: spec as ParamSpec }),
                };
              })()),
          skillKey: v.skill_key ?? '',
          difficulty: v.difficulty ?? -1,
          ...(media === undefined ? {} : { media }),
        }
      : {
          format: 'written' as const,
          stem: v.stem,
          rubricVersionId: v.rubric_version_id ?? '',
          skillKey: v.skill_key ?? '',
          difficulty: v.difficulty ?? -1,
          ...(media === undefined ? {} : { media }),
        };
  return {
    itemId: v.item_id,
    itemVersionId: v.id,
    versionNo: v.version_no,
    workspaceId: v.workspace_id,
    status: v.status as BankItemDetail['status'],
    origin: v.origin as BankItemDetail['origin'],
    isParameterised: v.is_parameterised,
    librarySourced,
    createdBy: v.created_by ?? '',
    approvedBy: v.approved_by,
    approvedAt: v.approved_at,
    exposureCount: exposure,
    content,
  };
};

/** The first 300 UTF-16 units of the stem, never ending in half a surrogate pair. */
const previewOf = (stem: string): string => {
  const cut = stem.slice(0, 300);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
};

export const summaryOf = (v: VersionRow, exposure: number): BankItemSummary => ({
  itemId: v.item_id,
  itemVersionId: v.id,
  versionNo: v.version_no,
  workspaceId: v.workspace_id,
  format: v.format,
  skillKey: v.skill_key ?? '',
  difficulty: v.difficulty,
  status: v.status as BankItemSummary['status'],
  origin: v.origin as BankItemSummary['origin'],
  stemPreview: previewOf(v.stem),
  isParameterised: v.is_parameterised,
  exposureCount: exposure,
  createdAt: v.created_at,
});
