// Fixtures for the import tests (spec m1 §4.3, §6.9): an open import job in ORG/WS, a stand-in for
// `public.import_item_batch` (M1-c: stores the api-found errors, finds duplicate_in_bank by content hash, stores the
// other rows as items of the job, idempotent on the row number), a fake ITEM_MEDIA store, and tiny synthetic image
// headers (PNG, JPEG, WebP) of a chosen size. Synthetic data only.
import type { FakeDb, Row } from '../tests/rest.test-helpers.js';
import {
  a2aDb,
  callerOf,
  fakeVariants,
  harness,
  ORG,
  stamp,
  WS,
} from '../bank/a2a.test-helpers.js';
import type { ItemMediaStore } from './media.js';
import { createImportsRoutes } from './routes.js';

export const JOB = 'c8000000-0000-4000-8000-000000000001';

/** import_item_batch as M1-c: p_rows in the api's DB shape; answers {accepted, errors} for the batch's rows. */
const importItemBatch = (args: Readonly<Record<string, unknown>>, db: FakeDb) => {
  const job = (db.tables.import_jobs ?? []).find((j) => j.id === args.p_job);
  if (job === undefined) throw new Error('fake: job');
  if (job.status === 'open') job.status = 'validating';
  const versions = (db.tables.item_versions ??= []);
  const errors = (db.tables.import_row_errors ??= []);
  const nos: number[] = [];
  for (const row of args.p_rows as Row[]) {
    const no = Number(row.rowNo);
    nos.push(no);
    if (
      versions.some((v) => v.import_job_id === job.id && v.import_row_no === no) ||
      errors.some((e) => e.import_job_id === job.id && e.row_no === no)
    ) {
      continue;
    }
    let errs = (row.errors as { field: string; code: string }[] | undefined) ?? [];
    if (errs.length === 0) {
      if (
        versions.some((v) => v.import_job_id !== job.id && v.content_sha256 === row.contentSha256)
      ) {
        errs = [{ field: 'row', code: 'duplicate_in_bank' }];
      }
    }
    if (errs.length > 0) {
      for (const e of errs) {
        errors.push({
          org_id: ORG,
          import_job_id: job.id,
          row_no: no,
          field: e.field,
          error_code: e.code,
        });
      }
      continue;
    }
    versions.push({
      id: `c9000000-0000-4000-8000-${no.toString(16).padStart(12, '0')}`,
      org_id: ORG,
      workspace_id: WS,
      section_id: null,
      import_job_id: job.id,
      import_row_no: no,
      content_sha256: row.contentSha256,
      media: row.imageKey === undefined ? null : [{ key: row.imageKey, alt: row.imageAlt }],
      status: 'approved',
      sent: row,
    });
  }
  return {
    accepted: versions.filter(
      (v) => v.import_job_id === job.id && nos.includes(Number(v.import_row_no)),
    ).length,
    errors: errors
      .filter((e) => e.import_job_id === job.id && nos.includes(Number(e.row_no)))
      .sort(
        (a, b) =>
          Number(a.row_no) - Number(b.row_no) || String(a.field).localeCompare(String(b.field)),
      )
      .map((e) => ({ rowNo: e.row_no, field: e.field, code: e.error_code })),
  };
};

export const fakeMedia = () => {
  const objects = new Map<string, { size: number; contentType: string | null }>();
  const puts: string[] = [];
  const store: ItemMediaStore = {
    async head(key) {
      return objects.get(key) ?? null;
    },
    async put(key, bytes, contentType) {
      puts.push(key);
      objects.set(key, { size: bytes.byteLength, contentType });
    },
  };
  return { store, objects, puts };
};

export const importsSetup = (
  opts: { status?: string; noMedia?: boolean; roles?: string[] } = {},
) => {
  const db = a2aDb(opts.roles === undefined ? {} : { roles: opts.roles });
  db.functions.import_item_batch = importItemBatch;
  (db.tables.import_jobs ??= []).push({
    id: JOB,
    org_id: ORG,
    workspace_id: WS,
    source_kind: 'xlsx',
    template_version: 'trace-items-v1',
    status: opts.status ?? 'open',
    rows_total: 0,
    rows_ok: 0,
    rows_error: 0,
    images_ok: 0,
    error_code: null,
    created_at: stamp(),
    completed_at: null,
  });
  const media = fakeMedia();
  const { app, call } = harness(
    (org) =>
      createImportsRoutes({
        org,
        media: () => (opts.noMedia === true ? null : media.store),
        variants: () => fakeVariants,
      }),
    db,
    callerOf(),
  );
  return { db, call, media, app };
};

const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16be = (n: number) => [(n >>> 8) & 255, n & 255];
const u24le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

/** A PNG signature and IHDR of the given size, padded to `length` bytes. */
export const pngBytes = (width: number, height: number, length = 64): Uint8Array => {
  const head = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
  const out = new Uint8Array(Math.max(length, 33));
  out.set([...head, ...u32be(width), ...u32be(height), 8, 6, 0, 0, 0]);
  return out;
};

/** A JPEG SOI, an APP0 segment and an SOF0 of the given size. */
export const jpegBytes = (width: number, height: number): Uint8Array =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0,
    16,
    74,
    70,
    73,
    70,
    0,
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    0xff,
    0xc0,
    0,
    17,
    8,
    ...u16be(height),
    ...u16be(width),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
    0xff,
    0xd9,
  ]);

/** A RIFF/WEBP VP8X header of the given size. */
export const webpBytes = (width: number, height: number): Uint8Array =>
  new Uint8Array([
    82,
    73,
    70,
    70,
    30,
    0,
    0,
    0,
    87,
    69,
    66,
    80,
    86,
    80,
    56,
    88,
    10,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...u24le(width - 1),
    ...u24le(height - 1),
    0,
    0,
  ]);

export const sha256Of = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};
