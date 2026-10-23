// Import jobs and images (spec m1 §3.2 import_jobs, §4.3, §6.9, §6.11 imports rows, R2-19, R5-18, R5-51 c/g, R5-55 d;
// E11, E12): a job is opened by an org user, takes content-addressed images one by one (magic bytes PNG/JPEG/WebP,
// at most 1 MiB, at most 4096 px a side, the path hash re-checked; an existing key is a no-op), and ends completed
// (only after a batch moved it to validating), or cancelled (rows already imported are kept, R5-51 g). A refused image
// answers `image_too_large` or `image_bad_type` (the codes the recruiter app has words for) or `image_refused`.
// Synthetic data only.
import { ImportJobCreateResponse, ImportJobView } from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import { codeOf, ORG, WS } from '../bank/a2a.test-helpers.js';
import {
  importsSetup,
  JOB,
  jpegBytes,
  pngBytes,
  sha256Of,
  webpBytes,
} from './imports.test-helpers.js';

const put = (
  call: ReturnType<typeof importsSetup>['call'],
  sha: string,
  bytes: Uint8Array,
  type = 'image/png',
  job = JOB,
) => call('PUT', `/imports/${job}/images/${sha}`, bytes, { 'content-type': type });

describe('POST …/imports and GET …/imports/:id', () => {
  it('opens a job in the default workspace and reads it back', async () => {
    const { call } = importsSetup();
    const res = await call('POST', '/imports', {
      sourceKind: 'xlsx',
      templateVersion: 'trace-items-v1',
    });
    expect(res.status).toBe(201);
    const job = ImportJobCreateResponse.parse(await res.json());
    expect(job).toMatchObject({ status: 'open', workspaceId: WS, rowsTotal: 0 });
    const read = await call('GET', `/imports/${job.id}`);
    expect(ImportJobView.parse(await read.json()).id).toBe(job.id);
    expect((await call('GET', '/imports/c8000000-0000-4000-8000-0000000000ff')).status).toBe(404);
  });

  it('refuses an unknown template version', async () => {
    const { call } = importsSetup();
    const res = await call('POST', '/imports', { sourceKind: 'xlsx', templateVersion: 'v9' });
    expect(res.status).toBe(400);
  });
});

describe('POST …/imports/:id/complete and …/cancel', () => {
  it('completes a validating job with its counts and the number of distinct images', async () => {
    const { db, call } = importsSetup({ status: 'validating' });
    const key = (h: string) => [{ key: `item-media/${ORG}/${h.repeat(64)}.png`, alt: 'A chart' }];
    db.tables.item_versions?.push(
      { id: 'v1', org_id: ORG, import_job_id: JOB, import_row_no: 2, media: key('a') },
      { id: 'v2', org_id: ORG, import_job_id: JOB, import_row_no: 3, media: key('a') },
      { id: 'v3', org_id: ORG, import_job_id: JOB, import_row_no: 4, media: key('b') },
      { id: 'v4', org_id: ORG, import_job_id: JOB, import_row_no: 5, media: null },
    );
    db.tables.import_row_errors?.push({ org_id: ORG, import_job_id: JOB, row_no: 6 });
    const res = await call('POST', `/imports/${JOB}/complete`);
    expect(res.status).toBe(200);
    expect(ImportJobView.parse(await res.json())).toMatchObject({
      status: 'completed',
      rowsOk: 4,
      rowsError: 1,
      rowsTotal: 5,
      imagesOk: 2,
    });
  });

  it('answers 409 for completing an open job (no batch yet) or an ended one', async () => {
    const open = importsSetup();
    expect((await open.call('POST', `/imports/${JOB}/complete`)).status).toBe(409);
    const done = importsSetup({ status: 'cancelled' });
    expect((await done.call('POST', `/imports/${JOB}/complete`)).status).toBe(409);
    expect((await done.call('POST', `/imports/${JOB}/cancel`)).status).toBe(409);
  });

  it('cancels an open or validating job and keeps the rows already imported (R5-51 g)', async () => {
    const { db, call } = importsSetup({ status: 'validating' });
    db.tables.item_versions?.push({ id: 'v1', org_id: ORG, import_job_id: JOB, import_row_no: 2 });
    const res = await call('POST', `/imports/${JOB}/cancel`);
    expect(res.status).toBe(200);
    expect(ImportJobView.parse(await res.json())).toMatchObject({ status: 'cancelled', rowsOk: 1 });
    expect(db.tables.item_versions).toHaveLength(1);
  });
});

describe('PUT …/imports/:id/images/:sha256', () => {
  it('stores a PNG, JPEG and WebP at their content-addressed keys; a second upload is a no-op (E12)', async () => {
    const { call, media } = importsSetup();
    for (const [bytes, type, ext] of [
      [pngBytes(640, 480), 'image/png', 'png'],
      [jpegBytes(800, 600), 'image/jpeg', 'jpg'],
      [webpBytes(4096, 10), 'image/webp', 'webp'],
    ] as const) {
      const sha = await sha256Of(bytes);
      const res = await put(call, sha, bytes, type);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ key: `item-media/${ORG}/${sha}.${ext}` });
    }
    expect(media.puts).toHaveLength(3);
    const bytes = pngBytes(640, 480);
    await put(call, await sha256Of(bytes), bytes);
    expect(media.puts).toHaveLength(3);
  });

  it('refuses an image over 1 MiB (image_too_large), a non-image or mismatched type (image_bad_type)', async () => {
    const { call, media } = importsSetup();
    const big = pngBytes(10, 10, 1_048_577);
    const r1 = await put(call, await sha256Of(big), big);
    expect(r1.status).toBe(413);
    expect(await codeOf(r1)).toBe('image_too_large');
    const gif = new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0]);
    const r2 = await put(call, await sha256Of(gif), gif, 'image/png');
    expect(r2.status).toBe(415);
    expect(await codeOf(r2)).toBe('image_bad_type');
    const png = pngBytes(10, 10);
    const r3 = await put(call, await sha256Of(png), png, 'image/jpeg');
    expect(await codeOf(r3)).toBe('image_bad_type');
    expect(media.puts).toEqual([]);
  });

  it('refuses a hash that is not the bytes, a side over 4096 px and an empty body (image_refused)', async () => {
    const { call, media } = importsSetup();
    const png = pngBytes(10, 10);
    const r1 = await put(call, 'ab'.repeat(32), png);
    expect(r1.status).toBe(422);
    expect(await codeOf(r1)).toBe('image_refused');
    const wide = pngBytes(4097, 10);
    expect(await codeOf(await put(call, await sha256Of(wide), wide))).toBe('image_refused');
    const empty = new Uint8Array();
    expect(await codeOf(await put(call, await sha256Of(empty), empty))).toBe('image_refused');
    expect(media.puts).toEqual([]);
  });

  it('answers 409 for an ended job, 404 for a bad hash path, 503 without the media bucket', async () => {
    const png = pngBytes(10, 10);
    const sha = await sha256Of(png);
    const ended = importsSetup({ status: 'completed' });
    expect((await put(ended.call, sha, png)).status).toBe(409);
    const s = importsSetup();
    expect((await put(s.call, 'XYZ', png)).status).toBe(404);
    const none = importsSetup({ noMedia: true });
    expect((await put(none.call, sha, png)).status).toBe(503);
  });
});
