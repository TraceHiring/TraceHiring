// The import session (spec §6.9, §4.3, E12, E13, R5-51 g): create the job, upload images six at a time, send rows in
// batches of at most 100 three at a time, keep every error, finish or cancel (cancel keeps what was imported).
import type {
  ImportImagePutResponse,
  ImportJobView,
  ImportRow,
  ImportRowsResponse,
} from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import type { ApiResult } from '../../api/client';
import { pngBytes } from './fixtures.test-helpers';
import { sha256Hex, type PreparedImage } from './images';
import type { ParsedImport } from './parse';
import { ImportSession, type ImportApi, type RunState } from './run';
import type { RowIssue } from './rows';
import { rowErrorText } from './texts';

const JOB_ID = '33333333-3333-4333-8333-333333333333';
const WS_ID = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-10-23T10:00:00.000Z';

const job = (over: Partial<ImportJobView> = {}): ImportJobView => ({
  id: JOB_ID,
  workspaceId: WS_ID,
  sourceKind: 'xlsx',
  templateVersion: 'trace-items-v1',
  status: 'open',
  rowsTotal: 0,
  rowsOk: 0,
  rowsError: 0,
  imagesOk: 0,
  createdAt: NOW,
  completedAt: null,
  ...over,
});
const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
const bad = (code: string): ApiResult<never> => ({ ok: false, code });

const mcq = (rowNo: number, imageSha256?: string): ImportRow => ({
  rowNo,
  format: 'mcq',
  skillKey: 'quant',
  difficulty: 0.5,
  stem: `[synthetic] q${rowNo}`,
  options: ['one', 'two'],
  correct: 'a',
  ...(imageSha256 === undefined ? {} : { imageSha256, imageAlt: 'alt' }),
});

async function image(seed: number): Promise<PreparedImage> {
  const bytes = pngBytes(seed);
  return { sha256: await sha256Hex(bytes), type: 'image/png', bytes };
}
const parsedOf = (
  rows: ImportRow[],
  images: PreparedImage[] = [],
  issues: RowIssue[] = [],
): ParsedImport => ({
  sourceKind: 'xlsx',
  rows,
  issues,
  images,
  rowsRead: rows.length + issues.length,
  imagesInFile: images.length,
});

/** A scriptable fake of the six api calls. `rowsScript` / `imageScript` return a result per call (default: ok). */
function fakeApi(
  over: {
    create?: () => ApiResult<ImportJobView>;
    image?: (
      sha: string,
      call: number,
    ) => ApiResult<ImportImagePutResponse> | Promise<ApiResult<ImportImagePutResponse>>;
    rows?: (
      rows: ImportRow[],
      call: number,
    ) => ApiResult<ImportRowsResponse> | Promise<ApiResult<ImportRowsResponse>>;
    complete?: () => ApiResult<ImportJobView>;
    cancel?: () => ApiResult<ImportJobView>;
  } = {},
) {
  const log = {
    created: 0,
    createdWith: [] as unknown[],
    imageCalls: [] as string[],
    batches: [] as number[][],
    completes: 0,
    cancels: 0,
    inFlightImages: 0,
    maxImages: 0,
    inFlightBatches: 0,
    maxBatches: 0,
  };
  const api: ImportApi = {
    createJob(body) {
      log.created += 1;
      log.createdWith.push(body);
      return Promise.resolve(over.create?.() ?? ok(job()));
    },
    async putImage(_jobId, sha) {
      log.imageCalls.push(sha);
      log.inFlightImages += 1;
      log.maxImages = Math.max(log.maxImages, log.inFlightImages);
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      log.inFlightImages -= 1;
      const key = `item-media/${'1'.repeat(8)}-1111-4111-8111-${'1'.repeat(12)}/${sha}.png`;
      return over.image?.(sha, log.imageCalls.length) ?? ok({ key });
    },
    async postRows(_jobId, rows) {
      log.batches.push(rows.map((r) => r.rowNo));
      log.inFlightBatches += 1;
      log.maxBatches = Math.max(log.maxBatches, log.inFlightBatches);
      await new Promise((r) => setTimeout(r, 1));
      log.inFlightBatches -= 1;
      return over.rows?.(rows, log.batches.length) ?? ok({ accepted: rows.length, errors: [] });
    },
    completeJob() {
      log.completes += 1;
      return Promise.resolve(
        over.complete?.() ?? ok(job({ status: 'completed', completedAt: NOW })),
      );
    },
    cancelJob() {
      log.cancels += 1;
      return Promise.resolve(over.cancel?.() ?? ok(job({ status: 'cancelled', completedAt: NOW })));
    },
  };
  return { api, log };
}
const noSleep = () => Promise.resolve();
const session = (p: ParsedImport, api: ImportApi) => new ImportSession(p, api, { sleep: noSleep });

describe('a clean import', () => {
  it('creates the job once, uploads each image once, and sends rows in batches of at most 100 in row order', async () => {
    const img = await image(1);
    const rows = Array.from({ length: 250 }, (_, i) => mcq(i + 2, i < 3 ? img.sha256 : undefined));
    const { api, log } = fakeApi();
    const s = session(parsedOf(rows, [img]), api);
    await s.start();
    const state = s.state();
    expect(state.phase).toBe('ready');
    expect(state.jobId).toBe(JOB_ID);
    expect(log.created).toBe(1);
    expect(log.createdWith).toEqual([{ sourceKind: 'xlsx', templateVersion: 'trace-items-v1' }]);
    expect(log.imageCalls).toEqual([img.sha256]);
    expect(log.batches.map((b) => b.length).sort((a, b) => b - a)).toEqual([100, 100, 50]);
    expect(log.batches.flat().sort((a, b) => a - b)).toEqual(rows.map((r) => r.rowNo));
    for (const batch of log.batches) expect(batch).toEqual([...batch].sort((a, b) => a - b));
    expect(state.accepted).toBe(250);
    expect(state.rowsSent).toBe(250);
    expect(state.issues).toEqual([]);
    expect(log.completes).toBe(0);
  });

  it('uploads images six at a time and sends batches three at a time', async () => {
    const images = await Promise.all(Array.from({ length: 20 }, (_, i) => image(i + 1)));
    const rows = images.map((img, i) => mcq(i + 2, img.sha256));
    const many = Array.from({ length: 700 }, (_, i) => mcq(i + 100, undefined));
    const { api, log } = fakeApi();
    const s = session(parsedOf([...rows, ...many], images), api);
    await s.start();
    expect(log.imageCalls).toHaveLength(20);
    expect(log.maxImages).toBe(6);
    expect(log.batches.length).toBeGreaterThanOrEqual(8);
    expect(log.maxBatches).toBe(3);
  });

  it('finishes the job on request and shows the api counts', async () => {
    const { api, log } = fakeApi({
      complete: () =>
        ok(job({ status: 'completed', completedAt: NOW, rowsTotal: 2, rowsOk: 1, rowsError: 1 })),
    });
    const s = session(parsedOf([mcq(2), mcq(3)]), api);
    await s.start();
    await s.complete();
    expect(log.completes).toBe(1);
    const state = s.state();
    expect(state.phase).toBe('completed');
    expect(state.job).toMatchObject({ rowsOk: 1, rowsError: 1 });
  });

  it('refuses to start with nothing to send and calls nothing (no job is created for an empty import)', async () => {
    const { api, log } = fakeApi();
    const s = session(parsedOf([], [], [{ rowNo: 2, field: 'stem', code: 'missing_field' }]), api);
    await s.start();
    expect(log.created).toBe(0);
    expect(s.state().phase).toBe('idle');
    expect(s.state().issues).toEqual([{ rowNo: 2, field: 'stem', code: 'missing_field' }]);
  });
});

describe('errors: none is lost, none is a value', () => {
  it('merges the page errors with the api errors, ordered by row, and keeps the counts', async () => {
    const local: RowIssue[] = [
      { rowNo: 5, field: 'correct', code: 'bad_key' },
      { rowNo: 2, field: 'stem', code: 'missing_field' },
    ];
    const { api } = fakeApi({
      rows: (rows) =>
        ok({
          accepted: rows.length - 1,
          errors: [{ rowNo: 4, field: 'skill' as const, code: 'bad_skill' as const }],
        }),
    });
    const s = session(parsedOf([mcq(3), mcq(4), mcq(6)], [], local), api);
    await s.start();
    expect(s.state().issues.map((i) => `${i.rowNo}:${i.field}:${i.code}`)).toEqual([
      '2:stem:missing_field',
      '4:skill:bad_skill',
      '5:correct:bad_key',
    ]);
    expect(s.state().accepted).toBe(2);
  });

  it('a row the api rejects with a code is shown with that code and field (duplicate_in_bank, E14)', async () => {
    const { api } = fakeApi({
      rows: (rows) =>
        ok({
          accepted: rows.length - 2,
          errors: [
            { rowNo: 3, field: 'row', code: 'duplicate_in_bank' },
            { rowNo: 4, field: 'param_spec_json', code: 'variant_generation_failed' },
          ],
        }),
    });
    const s = session(parsedOf([mcq(2), mcq(3), mcq(4)]), api);
    await s.start();
    expect(s.state().issues).toEqual([
      { rowNo: 3, field: 'row', code: 'duplicate_in_bank' },
      { rowNo: 4, field: 'param_spec_json', code: 'variant_generation_failed' },
    ]);
  });

  it('a re-sent batch (a network retry) is idempotent: no double counts, no double errors (E13)', async () => {
    let first = true;
    const { api, log } = fakeApi({
      rows: (rows) => {
        const answer = ok({
          accepted: rows.length - 1,
          errors: [{ rowNo: 3, field: 'stem' as const, code: 'too_long' as const }],
        });
        if (first) {
          first = false;
          return bad('network'); // stored on the server, answer lost
        }
        return answer;
      },
    });
    const s = session(parsedOf([mcq(2), mcq(3), mcq(4)]), api);
    await s.start();
    expect(log.batches).toEqual([
      [2, 3, 4],
      [2, 3, 4],
    ]);
    expect(s.state().phase).toBe('ready');
    expect(s.state().accepted).toBe(2);
    expect(s.state().issues).toEqual([{ rowNo: 3, field: 'stem', code: 'too_long' }]);
  });
});

describe('failures', () => {
  it('retries a transient failure up to three times and then stops with the code, keeping the job', async () => {
    const { api, log } = fakeApi({ rows: () => bad('unavailable') });
    const s = session(parsedOf([mcq(2)]), api);
    await s.start();
    expect(log.batches).toHaveLength(3);
    const state = s.state();
    expect(state.phase).toBe('stopped');
    expect(state.failure).toBe('unavailable');
    expect(state.jobId).toBe(JOB_ID);
  });

  it('does not retry a permanent failure', async () => {
    for (const code of [
      'aal2_required',
      'unauthorized',
      'not_found',
      'conflict',
      'bad_request',
      'invalid_response',
    ]) {
      const { api, log } = fakeApi({ rows: () => bad(code) });
      const s = session(parsedOf([mcq(2)]), api);
      await s.start();
      expect(log.batches, code).toHaveLength(1);
      expect(s.state().phase).toBe('stopped');
      expect(s.state().failure).toBe(code);
    }
  });

  it('resume sends only the batches that were not done, and reuses the job and the uploaded images', async () => {
    const img = await image(1);
    const rows = Array.from({ length: 150 }, (_, i) =>
      mcq(i + 2, i === 0 ? img.sha256 : undefined),
    );
    let failSecond = true;
    const { api, log } = fakeApi({
      rows: (batch) => {
        if (batch[0]?.rowNo === 102 && failSecond) {
          failSecond = false;
          return bad('rate_limited');
        }
        return ok({ accepted: batch.length, errors: [] });
      },
    });
    const s = new ImportSession(parsedOf(rows, [img]), api, { sleep: noSleep, retries: 1 });
    await s.start();
    expect(s.state().phase).toBe('stopped');
    expect(s.state().failure).toBe('rate_limited');
    const sentBefore = log.batches.length;
    await s.resume();
    expect(log.created).toBe(1);
    expect(log.imageCalls).toHaveLength(1);
    expect(log.batches.slice(sentBefore)).toEqual([rows.slice(100).map((r) => r.rowNo)]);
    expect(s.state().phase).toBe('ready');
    expect(s.state().accepted).toBe(150);
  });

  it('stops before any row when the job cannot be created; start again creates it', async () => {
    let n = 0;
    const { api, log } = fakeApi({ create: () => (n++ === 0 ? bad('aal2_required') : ok(job())) });
    const s = session(parsedOf([mcq(2)]), api);
    await s.start();
    expect(s.state()).toMatchObject({ phase: 'stopped', failure: 'aal2_required', jobId: null });
    expect(log.batches).toEqual([]);
    await s.resume();
    expect(s.state().phase).toBe('ready');
    expect(log.created).toBe(2);
  });

  it('an image the api refuses (too large, bad type) becomes an error on its rows, which are not sent', async () => {
    const [a, b] = await Promise.all([image(1), image(2)]);
    const { api, log } = fakeApi({
      image: (sha) =>
        sha === a.sha256
          ? bad('image_too_large')
          : ok({ key: `item-media/${'1'.repeat(8)}-1111-4111-8111-${'1'.repeat(12)}/${sha}.png` }),
    });
    const s = session(
      parsedOf([mcq(2, a.sha256), mcq(3, b.sha256), mcq(4, a.sha256), mcq(5)], [a, b]),
      api,
    );
    await s.start();
    expect(s.state().issues).toEqual([
      { rowNo: 2, field: 'image_file', code: 'image_too_large' },
      { rowNo: 4, field: 'image_file', code: 'image_too_large' },
    ]);
    expect(log.batches).toEqual([[3, 5]]);
    const typed = fakeApi({ image: () => bad('image_bad_type') });
    const t = session(parsedOf([mcq(2, a.sha256), mcq(3)], [a]), typed.api);
    await t.start();
    expect(t.state().issues).toEqual([{ rowNo: 2, field: 'image_file', code: 'image_bad_type' }]);
  });

  it('any other image failure stops the import before rows, with the code', async () => {
    const img = await image(1);
    const { api, log } = fakeApi({ image: () => bad('aal2_required') });
    const s = session(parsedOf([mcq(2, img.sha256), mcq(3)], [img]), api);
    await s.start();
    expect(s.state()).toMatchObject({ phase: 'stopped', failure: 'aal2_required' });
    expect(log.batches).toEqual([]);
  });
});

describe('an image the api refuses (S7)', () => {
  it('any other refusal of one image is a row error for its rows, and the run goes on', async () => {
    const [bad1, good] = await Promise.all([image(1), image(2)]);
    const { api, log } = fakeApi({
      image: (sha) =>
        sha === bad1.sha256
          ? bad('image_too_wide')
          : ok({ key: `item-media/${'1'.repeat(8)}-1111-4111-8111-${'1'.repeat(12)}/${sha}.png` }),
    });
    const s = session(
      parsedOf([mcq(2, bad1.sha256), mcq(3, good.sha256), mcq(4, bad1.sha256)], [bad1, good]),
      api,
    );
    await s.start();
    const state = s.state();
    expect(state.phase).toBe('ready');
    expect(state.failure).toBeNull();
    expect(state.issues.map((i) => `${i.rowNo}:${i.field}:${i.code}`)).toEqual([
      '2:image_file:image_refused',
      '4:image_file:image_refused',
    ]);
    expect(log.batches.flat()).toEqual([3]);
    expect(log.imageCalls.filter((sha) => sha === bad1.sha256)).toHaveLength(1);
    expect(rowErrorText('image_refused')).toBe('The server refused this image.');
  });

  it('a refusal that is about the session or the job, not the image, still stops the run', async () => {
    for (const code of ['forbidden', 'unauthorized', 'aal2_required', 'not_found', 'conflict']) {
      const img = await image(1);
      const { api, log } = fakeApi({ image: () => bad(code) });
      const s = session(parsedOf([mcq(2, img.sha256)], [img]), api);
      await s.start();
      expect(s.state(), code).toMatchObject({ phase: 'stopped', failure: code });
      expect(log.batches, code).toEqual([]);
    }
  });
});

describe('finish and cancel', () => {
  it('a job the api fails on finish (row_limit, image_limit, timeout, internal) is shown as failed with its code', async () => {
    for (const errorCode of ['row_limit', 'image_limit', 'timeout', 'internal'] as const) {
      const { api } = fakeApi({
        complete: () => ok(job({ status: 'failed', errorCode, completedAt: NOW })),
      });
      const s = session(parsedOf([mcq(2)]), api);
      await s.start();
      await s.complete();
      expect(s.state()).toMatchObject({ phase: 'failed', failure: errorCode });
    }
  });

  it('a finish call that fails keeps the import ready so the user can try again', async () => {
    let n = 0;
    const { api, log } = fakeApi({
      complete: () =>
        n++ === 0 ? bad('network') : ok(job({ status: 'completed', completedAt: NOW })),
    });
    const s = session(parsedOf([mcq(2)]), api);
    await s.start();
    await s.complete();
    expect(s.state()).toMatchObject({ phase: 'ready', failure: 'network' });
    await s.complete();
    expect(s.state().phase).toBe('completed');
    expect(log.completes).toBe(2);
  });

  it('cancel keeps the rows already imported and reports the job as cancelled', async () => {
    const { api, log } = fakeApi({
      cancel: () => ok(job({ status: 'cancelled', completedAt: NOW, rowsTotal: 2, rowsOk: 2 })),
    });
    const s = session(parsedOf([mcq(2), mcq(3)]), api);
    await s.start();
    await s.cancel();
    expect(log.cancels).toBe(1);
    expect(s.state().phase).toBe('cancelled');
    expect(s.state().job).toMatchObject({ rowsOk: 2 });
  });

  it('cancel during the run stops new batches, lets the ones in flight end, then cancels the job', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => mcq(i + 2));
    const holder: { s?: ImportSession } = {};
    let answered = 0;
    const { api, log } = fakeApi({
      rows: () => {
        if (++answered === 1) void holder.s?.cancel();
        return ok({ accepted: 100, errors: [] });
      },
    });
    const s = session(parsedOf(rows), api);
    holder.s = s;
    await s.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(log.cancels).toBe(1);
    expect(log.batches.length).toBeLessThan(10);
    expect(s.state().phase).toBe('cancelled');
  });

  it('cancel before the job exists just ends the import; cancel that fails can be tried again', async () => {
    const none = fakeApi({ create: () => bad('network') });
    const a = session(parsedOf([mcq(2)]), none.api);
    await a.start();
    await a.cancel();
    expect(none.log.cancels).toBe(0);
    expect(a.state().phase).toBe('cancelled');

    let n = 0;
    const { api, log } = fakeApi({
      cancel: () =>
        n++ === 0 ? bad('unavailable') : ok(job({ status: 'cancelled', completedAt: NOW })),
    });
    const b = session(parsedOf([mcq(2)]), api);
    await b.start();
    await b.cancel();
    expect(b.state()).toMatchObject({ phase: 'ready', failure: 'unavailable' });
    await b.cancel();
    expect(b.state().phase).toBe('cancelled');
    expect(log.cancels).toBe(2);
  });

  it('a second cancel click while the first is still waiting sends one cancel and ends cancelled (S1)', async () => {
    const rows = Array.from({ length: 400 }, (_, i) => mcq(i + 2));
    // A second cancel call would be refused, as the api refuses to cancel a job already cancelled.
    let calls = 0;
    const { api, log } = fakeApi({
      rows: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return ok({ accepted: 100, errors: [] });
      },
      cancel: () =>
        ++calls === 1 ? ok(job({ status: 'cancelled', completedAt: NOW })) : bad('conflict'),
    });
    const s = session(parsedOf(rows), api);
    const run = s.start();
    await new Promise((r) => setTimeout(r, 2));
    const first = s.cancel();
    const second = s.cancel();
    await Promise.all([first, second, run]);
    expect(log.cancels).toBe(1);
    expect(s.state()).toMatchObject({ phase: 'cancelled', failure: null });
  });

  it('notifies listeners of every change with a copy of the state', async () => {
    const { api } = fakeApi();
    const seen: RunState[] = [];
    const s = new ImportSession(parsedOf([mcq(2)]), api, {
      sleep: noSleep,
      onChange: (st) => seen.push(st),
    });
    await s.start();
    expect(seen.length).toBeGreaterThan(2);
    expect(seen[0]?.phase).toBe('running');
    expect(seen.at(-1)?.phase).toBe('ready');
    expect(seen[0]).not.toBe(seen.at(-1));
  });
});
