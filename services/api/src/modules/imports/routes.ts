// Excel/Word import, server side (spec m1 §3.2 import_jobs, §4.3, §6.9, §6.11 imports rows, M1-9, Q23, R2-19, R3-5,
// R5-18, R5-37, R5-51 c/g, R5-55 d; E9-E14; AT-M1-10/11 api part). The file never reaches the api: the browser parses it
// and sends the job, the images and the rows.
//
// - `POST …/imports` opens a job as the caller; `GET …/imports/:id` reads it.
// - `PUT …/imports/:id/images/:sha256` takes one image's raw bytes (at most 1 MiB, R5-55 d): the magic bytes must be
//   PNG, JPEG or WebP and agree with the declared content type, each side at most 4096 px, and the bytes must hash to
//   the path's SHA-256. The object is stored at `item-media/{org}/{sha256}.{ext}` (an existing key is a no-op, E12).
//   Refusals answer `image_too_large`, `image_bad_type` (the codes the recruiter app has words for) or
//   `image_refused`.
// - `POST …/imports/:id/rows` re-validates every row (rows.ts), finds each row's stored image, generates the variants
//   of a parameterised row (§6.3), computes the R5-49 a content hash over the letter option ids `import_item_batch`
//   stores, marks a repeat of an earlier row of the batch `duplicate_in_file`, and sends the batch to
//   `public.import_item_batch` (idempotent on the row number, E13; `duplicate_in_bank` and the approval by the
//   importer, Q23, happen there). The answer lists every bad row by row, column and code; never a cell value.
// - `…/complete` (validating only) records the number of distinct images the job's items use; `…/cancel` ends an open
//   or validating job and keeps the rows already imported (R5-51 g, founder default a).
import {
  IMPORT_IMAGE_MAX_BYTES,
  ImportJobCreateRequest,
  ImportJobCreateResponse,
  ImportImagePutResponse,
  ImportJobView,
  ImportRowsResponse,
  type ImportRow,
} from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  AUTHORS,
  contentHashOf,
  defaultWorkspace,
  variantsForImportRow,
  type VariantEngine,
  type VariantRow,
} from '../bank/content.js';
import { parseRows } from '../tests/authoring.js';
import { answer, BODY_CAPS, parseBody, readJson } from '../tests/http.js';
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
} from '../tests/org-context.js';
import {
  IMAGE_TYPES,
  MAX_IMAGE_SIDE,
  mediaKeyOf,
  sniffImage,
  type ImageExt,
  type ItemMediaStore,
} from './media.js';
import { checkRow, type CheckedRow, type RowIssue } from './rows.js';

export interface ImportsDeps {
  org: OrgDeps;
  /** The ITEM_MEDIA bucket, or null when unbound (images answer 503). */
  media(env: Env): ItemMediaStore | null;
  /** `@trace/item-variants` (§6.3), or null when unbound (a batch with a parameterised row answers 503). */
  variants(env: Env): VariantEngine | null;
}

export const IMPORTS_PATH = '/v1/orgs/:orgId/imports';
export const IMPORT_PATH = '/v1/orgs/:orgId/imports/:importId';
export const IMPORT_IMAGE_PATH = '/v1/orgs/:orgId/imports/:importId/images/:sha256';
export const IMPORT_ROWS_PATH = '/v1/orgs/:orgId/imports/:importId/rows';
export const IMPORT_COMPLETE_PATH = '/v1/orgs/:orgId/imports/:importId/complete';
export const IMPORT_CANCEL_PATH = '/v1/orgs/:orgId/imports/:importId/cancel';

const JOB_COLS =
  'id,workspace_id,source_kind,template_version,status,rows_total,rows_ok,rows_error,images_ok,error_code,' +
  'created_at,completed_at';
const JobRow = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  source_kind: z.string(),
  template_version: z.string(),
  status: z.string(),
  rows_total: z.coerce.number().int(),
  rows_ok: z.coerce.number().int(),
  rows_error: z.coerce.number().int(),
  images_ok: z.coerce.number().int(),
  error_code: z.string().nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
});
type JobRow = z.infer<typeof JobRow>;

const viewOf = (j: JobRow) => ({
  id: j.id,
  workspaceId: j.workspace_id,
  sourceKind: j.source_kind,
  templateVersion: j.template_version,
  status: j.status,
  rowsTotal: j.rows_total,
  rowsOk: j.rows_ok,
  rowsError: j.rows_error,
  imagesOk: j.images_ok,
  ...(j.error_code === null ? {} : { errorCode: j.error_code }),
  createdAt: j.created_at,
  completedAt: j.completed_at,
});

const OPEN = new Set(['open', 'validating']);
const SHA256 = /^[0-9a-f]{64}$/;
const EXTS: readonly ImageExt[] = ['png', 'jpg', 'webp'];

const findJob = async (ctx: OrgContext, orgId: string, jobId: string): Promise<JobRow> => {
  const [row] = parseRows(
    JobRow,
    await ctx.rest.select('import_jobs', { select: JOB_COLS, id: eq(jobId), org_id: eq(orgId) }),
  );
  return row ?? orgFail('not_found');
};

/** An image refusal: `{ error: { code } }` with no-store, never echoing the bytes. */
const imageRefusal = (
  code: 'image_too_large' | 'image_bad_type' | 'image_refused',
  status: 413 | 415 | 422,
): Response =>
  new Response(JSON.stringify({ error: { code } }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/** The raw body, or null when it is over the cap (read as a stream; a declared length over the cap is refused first). */
const readImage = async (request: Request): Promise<Uint8Array | null> => {
  const declared = request.headers.get('content-length');
  if (
    declared !== null &&
    (!/^[0-9]{1,9}$/.test(declared) || Number(declared) > IMPORT_IMAGE_MAX_BYTES)
  ) {
    return null;
  }
  const body = request.body;
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > IMPORT_IMAGE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
};

const hexOf = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

/** The stored key of an image, or the row code that names why it cannot be used (E11: the api re-checks each). */
const storedImage = async (
  store: ItemMediaStore,
  orgId: string,
  sha256: string,
): Promise<{ key: string } | { code: 'image_missing' | 'image_too_large' | 'image_bad_type' }> => {
  for (const ext of EXTS) {
    const key = mediaKeyOf(orgId, sha256, ext);
    const head = await store.head(key);
    if (head === null) continue;
    if (head.size > IMPORT_IMAGE_MAX_BYTES) return { code: 'image_too_large' };
    if (head.contentType !== null && head.contentType !== IMAGE_TYPES[ext]) {
      return { code: 'image_bad_type' };
    }
    return { key };
  }
  return { code: 'image_missing' };
};

/** The batch envelope: `{rows: object[1..100]}`, each with a distinct integer rowNo 2..2001 (else 400). */
const Envelope = z.strictObject({
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(100)
    .refine(
      (rows) =>
        rows.every(
          (r) =>
            typeof r.rowNo === 'number' &&
            Number.isInteger(r.rowNo) &&
            r.rowNo >= 2 &&
            r.rowNo <= 2001,
        ) && new Set(rows.map((r) => r.rowNo)).size === rows.length,
    ),
});

type BatchRow =
  | { rowNo: number; errors: RowIssue[] }
  | (Record<string, unknown> & { rowNo: number; contentSha256: string });

/** One valid row in `import_item_batch`'s DB shape, or its row-level issue. */
const batchRowOf = async (
  orgId: string,
  jobId: string,
  row: ImportRow,
  image: { key: string } | { code: RowIssue['code'] } | null,
  engine: VariantEngine | null,
): Promise<BatchRow> => {
  if (image !== null && 'code' in image) {
    return { rowNo: row.rowNo, errors: [{ field: 'image_file', code: image.code }] };
  }
  const media = image === null ? null : [{ key: image.key, alt: row.imageAlt ?? '' }];
  const imagePart = image === null ? {} : { imageKey: image.key, imageAlt: row.imageAlt ?? '' };
  if (row.format === 'written') {
    return {
      rowNo: row.rowNo,
      format: 'written',
      skillKey: row.skillKey,
      difficulty: row.difficulty,
      stem: row.stem,
      rubricKey: row.rubricKey,
      ...imagePart,
      contentSha256: await contentHashOf({
        format: 'written',
        stem: row.stem,
        options: null,
        media,
        paramSpec: null,
      }),
    };
  }
  // import_item_batch stores the options with the ids a..f in sheet order.
  const options = row.options.map((text, i) => ({ id: String.fromCharCode(97 + i), text }));
  let variants: VariantRow[] | null = null;
  if (row.paramSpec !== undefined) {
    if (engine === null) return orgFail('unavailable');
    variants = await variantsForImportRow(engine, row.paramSpec, jobId, row.rowNo, row.difficulty);
    if (variants === null) {
      return {
        rowNo: row.rowNo,
        errors: [{ field: 'param_spec_json', code: 'variant_generation_failed' }],
      };
    }
  }
  return {
    rowNo: row.rowNo,
    format: 'mcq',
    skillKey: row.skillKey,
    difficulty: row.difficulty,
    stem: row.stem,
    options: row.options,
    correct: row.correct,
    ...imagePart,
    ...(row.paramSpec === undefined ? {} : { paramSpec: row.paramSpec, variants }),
    contentSha256: await contentHashOf({
      format: 'mcq',
      stem: row.stem,
      options,
      media,
      paramSpec: row.paramSpec ?? null,
    }),
  };
};

const MediaRow = z.object({
  id: z.string(),
  media: z.array(z.object({ key: z.string() })).nullable(),
});
type MediaRow = z.infer<typeof MediaRow>;

/** Distinct image keys used by the job's stored items (`images_ok` at completion), read in id-keyset pages. */
const imagesOf = async (ctx: OrgContext, orgId: string, jobId: string): Promise<number> => {
  const keys = new Set<string>();
  let after: string | null = null;
  for (;;) {
    const rows: MediaRow[] = parseRows(
      MediaRow,
      await ctx.rest.select('item_versions', {
        select: 'id,media',
        org_id: eq(orgId),
        import_job_id: eq(jobId),
        order: 'id.asc',
        limit: String(PGRST_MAX_ROWS),
        ...(after === null ? {} : { id: `gt.${after}` }),
      }),
    );
    for (const r of rows) for (const m of r.media ?? []) keys.add(m.key);
    const last: MediaRow | undefined = rows[rows.length - 1];
    if (rows.length < PGRST_MAX_ROWS || last === undefined) break;
    after = last.id;
  }
  return Math.min(keys.size, 2000);
};

/** Ends a job with a guarded status update; 0 rows is 404 (unseen) or 409 (not in a state that may end so). */
const endJob = async (
  ctx: OrgContext,
  orgId: string,
  jobId: string,
  from: string,
  patch: Record<string, unknown>,
): Promise<JobRow> => {
  const [row] = parseRows(
    JobRow,
    await ctx.rest.update(
      'import_jobs',
      { id: eq(jobId), org_id: eq(orgId), status: from, select: JOB_COLS },
      patch,
    ),
  );
  if (row !== undefined) return row;
  await findJob(ctx, orgId, jobId);
  return orgFail('conflict');
};

export const createImportsRoutes = (deps: ImportsDeps): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();

  app.post(IMPORTS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const req = parseBody(ImportJobCreateRequest, await readJson(c.req.raw));
      const workspaceId = req.workspaceId ?? (await defaultWorkspace(ctx, orgId));
      const [row] = parseRows(
        JobRow,
        await ctx.rest.insert(
          'import_jobs',
          {
            org_id: orgId,
            workspace_id: workspaceId,
            source_kind: req.sourceKind,
            template_version: req.templateVersion,
          },
          { select: JOB_COLS },
        ),
      );
      if (row === undefined) return orgFail('not_found');
      return answer(ImportJobCreateResponse, viewOf(row), 201);
    }),
  );

  app.get(IMPORT_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const jobId = pathId(c.req.param('importId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      return answer(ImportJobView, viewOf(await findJob(ctx, orgId, jobId)));
    }),
  );

  app.put(IMPORT_IMAGE_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const jobId = pathId(c.req.param('importId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const sha256 = c.req.param('sha256');
      if (!SHA256.test(sha256)) return orgFail('not_found');
      const store = deps.media(c.env) ?? orgFail('unavailable');
      const job = await findJob(ctx, orgId, jobId);
      if (!OPEN.has(job.status)) return orgFail('conflict');
      const bytes = await readImage(c.req.raw);
      if (bytes === null) return imageRefusal('image_too_large', 413);
      if (bytes.byteLength === 0) return imageRefusal('image_refused', 422);
      const sniffed = sniffImage(bytes);
      const declared = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
      if (sniffed === null || declared !== IMAGE_TYPES[sniffed.ext]) {
        return imageRefusal('image_bad_type', 415);
      }
      if (
        sniffed.width === null ||
        sniffed.height === null ||
        sniffed.width < 1 ||
        sniffed.height < 1 ||
        sniffed.width > MAX_IMAGE_SIDE ||
        sniffed.height > MAX_IMAGE_SIDE
      ) {
        return imageRefusal('image_refused', 422);
      }
      if ((await hexOf(bytes)) !== sha256) return imageRefusal('image_refused', 422);
      const key = mediaKeyOf(orgId, sha256, sniffed.ext);
      if ((await store.head(key)) === null) {
        try {
          await store.put(key, bytes, IMAGE_TYPES[sniffed.ext]);
        } catch {
          return orgFail('unavailable');
        }
      }
      return answer(ImportImagePutResponse, { key });
    }),
  );

  app.post(IMPORT_ROWS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const jobId = pathId(c.req.param('importId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const job = await findJob(ctx, orgId, jobId);
      if (!OPEN.has(job.status)) return orgFail('conflict');
      const envelope = parseBody(Envelope, await readJson(c.req.raw, BODY_CAPS.importRows));
      const engine = deps.variants(c.env);
      if (engine === null && envelope.rows.some((r) => r.paramSpec !== undefined)) {
        return orgFail('unavailable');
      }
      const checked: CheckedRow[] = envelope.rows.map((r) =>
        checkRow(r, r.rowNo as number, (spec) => engine?.check(spec) ?? false),
      );
      // Each distinct image the valid rows name, looked up once (E12).
      const shas = [
        ...new Set(
          checked.flatMap((r) => (r.row?.imageSha256 === undefined ? [] : [r.row.imageSha256])),
        ),
      ];
      let images = new Map<string, Awaited<ReturnType<typeof storedImage>>>();
      if (shas.length > 0) {
        const store = deps.media(c.env) ?? orgFail('unavailable');
        images = new Map(
          await Promise.all(
            shas.map(async (s) => [s, await storedImage(store, orgId, s)] as const),
          ),
        );
      }
      const seen = new Set<string>();
      const batch: BatchRow[] = [];
      for (const r of checked) {
        if (r.row === null) {
          batch.push({ rowNo: r.rowNo, errors: r.issues });
          continue;
        }
        const sha = r.row.imageSha256;
        const out = await batchRowOf(
          orgId,
          jobId,
          r.row,
          sha === undefined ? null : (images.get(sha) ?? { code: 'image_missing' }),
          engine,
        );
        if ('contentSha256' in out) {
          // A repeat of an earlier row of this batch (the database checks earlier batches of the job too).
          if (seen.has(out.contentSha256)) {
            batch.push({ rowNo: r.rowNo, errors: [{ field: 'row', code: 'duplicate_in_file' }] });
            continue;
          }
          seen.add(out.contentSha256);
        }
        batch.push(out);
      }
      const result = await rpcOf(ctx.rest)('import_item_batch', { p_job: jobId, p_rows: batch });
      return answer(ImportRowsResponse, result);
    }),
  );

  app.post(IMPORT_COMPLETE_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const jobId = pathId(c.req.param('importId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const job = await findJob(ctx, orgId, jobId);
      // §4.3 (R5-51 c): only a validating job completes (an open job has had no batch).
      if (job.status !== 'validating') return orgFail('conflict');
      const imagesOk = await imagesOf(ctx, orgId, jobId);
      const row = await endJob(ctx, orgId, jobId, 'eq.validating', {
        status: 'completed',
        images_ok: imagesOk,
      });
      return answer(ImportJobView, viewOf(row));
    }),
  );

  app.post(IMPORT_CANCEL_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const jobId = pathId(c.req.param('importId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      // R5-51 g (founder default a): the rows already imported stay; only the job ends.
      const row = await endJob(ctx, orgId, jobId, 'in.(open,validating)', {
        status: 'cancelled',
      });
      return answer(ImportJobView, viewOf(row));
    }),
  );

  return app;
};
