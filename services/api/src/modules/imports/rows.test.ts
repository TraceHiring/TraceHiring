// AT-M1-11 api part (ABH-9 "error shown for each bad row"; spec m1 §4.3, §6.9, M1-9, E10, E13, E14): the api
// re-validates every row of a batch server-side and answers every bad row with its row number, template column and a
// §4.3 code, never a cell value. Each code below comes from one synthetic fixture row. `duplicate_in_bank` is found by
// import_item_batch (the database, from the content hash the api computes; the stand-in here does the same) and
// `row_limit` is a job-level failure (a file over 2,000 rows fails before any batch, R5-51 c): a row number above 2001
// cannot be stored or answered, so it is a 400 of the whole batch here. Nothing is logged.
import { IMPORT_ERROR_CODES, ImportRowsResponse } from '@trace/shared/contracts/m1';
import { itemContentSha256 } from '@trace/shared/item-hash';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG, seedVersion } from '../bank/a2a.test-helpers.js';
import { importsSetup, JOB } from './imports.test-helpers.js';

const IMG_OK = 'aa'.repeat(32);
const IMG_BIG = 'bb'.repeat(32);
const IMG_GIF = 'cc'.repeat(32);
const IMG_NONE = 'dd'.repeat(32);

const mcq = (rowNo: number, patch: Record<string, unknown> = {}) => ({
  rowNo,
  format: 'mcq',
  skillKey: 'verbal',
  difficulty: 0.3,
  stem: `[synthetic] Imported stem ${String(rowNo)}`,
  options: ['Alpha choice', 'Beta choice'],
  correct: 'a',
  ...patch,
});

const without = (row: Record<string, unknown>, key: string) => {
  const out = { ...row };
  delete out[key];
  return out;
};

const badSpec = {
  params: { min: { kind: 'int', min: 1, max: 9, step: 1 } },
  derived: {},
  constraints: [],
  stem: '[synthetic] {{min}}',
  options: [
    { id: 'a', text: '{{min}}' },
    { id: 'b', text: 'none' },
  ],
  correctOptionId: 'a',
  count: 5,
};
const tinySpec = {
  params: { a: { kind: 'int', min: 1, max: 2, step: 1 } },
  derived: {},
  constraints: [],
  stem: '[synthetic] Value {{a}}',
  options: [
    { id: 'a', text: '{{a}}' },
    { id: 'b', text: 'zero' },
  ],
  correctOptionId: 'a',
  count: 5,
};

let logs: unknown[] = [];
beforeEach(() => {
  logs = [];
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a));
  }
});
afterEach(() => vi.restoreAllMocks());

const setup = async () => {
  const s = importsSetup();
  s.media.objects.set(`item-media/${ORG}/${IMG_OK}.png`, { size: 2048, contentType: 'image/png' });
  s.media.objects.set(`item-media/${ORG}/${IMG_BIG}.jpg`, {
    size: 1_048_577,
    contentType: 'image/jpeg',
  });
  s.media.objects.set(`item-media/${ORG}/${IMG_GIF}.png`, { size: 900, contentType: 'image/gif' });
  // A bank item whose content equals row 30's (duplicate_in_bank).
  seedVersion(s.db, {
    content_sha256: await itemContentSha256({
      format: 'mcq',
      stem: '[synthetic] Already in the bank',
      options: [
        { id: 'a', text: 'Alpha choice' },
        { id: 'b', text: 'Beta choice' },
      ],
      media: null,
      paramSpec: null,
    }),
  });
  return s;
};

describe('POST …/imports/:id/rows (AT-M1-11)', () => {
  it('answers each §4.3 row code from its fixture row, every bad row listed, no cell value anywhere', async () => {
    const { call, db } = await setup();
    const rows = [
      mcq(2),
      without(mcq(3), 'stem'),
      mcq(4, { format: 'essay' }),
      mcq(5, { skillKey: 'Not A Skill' }),
      mcq(6, { difficulty: 0.333 }),
      mcq(7, { options: ['Only one'] }),
      mcq(8, { correct: 'f' }),
      mcq(9, { stem: `[synthetic] ${'x'.repeat(4000)}` }),
      mcq(10, { imageSha256: 'not-a-hash', imageAlt: 'A synthetic chart' }),
      mcq(11, { imageSha256: IMG_NONE, imageAlt: 'A synthetic chart' }),
      mcq(12, { imageSha256: IMG_BIG, imageAlt: 'A synthetic chart' }),
      mcq(13, { imageSha256: IMG_GIF, imageAlt: 'A synthetic chart' }),
      mcq(14, { stem: '[synthetic] Twice in this file' }),
      mcq(15, { stem: '[synthetic] Twice in this file' }),
      mcq(30, { stem: '[synthetic] Already in the bank' }),
      mcq(16, { paramSpec: badSpec }),
      mcq(17, { paramSpec: tinySpec }),
      mcq(18, { imageSha256: IMG_OK, imageAlt: 'A synthetic chart' }),
    ];
    const res = await call('POST', `/imports/${JOB}/rows`, { rows });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = ImportRowsResponse.parse(JSON.parse(text));
    const byRow = new Map(body.errors.map((e) => [e.rowNo, e]));
    expect(byRow.get(3)).toEqual({ rowNo: 3, field: 'stem', code: 'missing_field' });
    expect(byRow.get(4)).toEqual({ rowNo: 4, field: 'format', code: 'bad_format' });
    expect(byRow.get(5)).toEqual({ rowNo: 5, field: 'skill', code: 'bad_skill' });
    expect(byRow.get(6)).toEqual({ rowNo: 6, field: 'difficulty', code: 'bad_difficulty' });
    expect(byRow.get(7)).toEqual({ rowNo: 7, field: 'options', code: 'bad_options' });
    expect(byRow.get(8)).toEqual({ rowNo: 8, field: 'correct', code: 'bad_key' });
    expect(byRow.get(9)).toEqual({ rowNo: 9, field: 'stem', code: 'too_long' });
    expect(byRow.get(10)).toEqual({ rowNo: 10, field: 'image_file', code: 'bad_image_ref' });
    expect(byRow.get(11)).toEqual({ rowNo: 11, field: 'image_file', code: 'image_missing' });
    expect(byRow.get(12)).toEqual({ rowNo: 12, field: 'image_file', code: 'image_too_large' });
    expect(byRow.get(13)).toEqual({ rowNo: 13, field: 'image_file', code: 'image_bad_type' });
    expect(byRow.has(14)).toBe(false);
    expect(byRow.get(15)).toEqual({ rowNo: 15, field: 'row', code: 'duplicate_in_file' });
    expect(byRow.get(30)).toEqual({ rowNo: 30, field: 'row', code: 'duplicate_in_bank' });
    expect(byRow.get(16)).toEqual({ rowNo: 16, field: 'param_spec_json', code: 'bad_param_spec' });
    expect(byRow.get(17)).toEqual({
      rowNo: 17,
      field: 'param_spec_json',
      code: 'variant_generation_failed',
    });
    expect(body.accepted).toBe(3);
    expect(body.errors).toHaveLength(15);
    // Every §4.3 code but the job-level row_limit came from a row.
    const seen = new Set(body.errors.map((e) => e.code));
    expect(IMPORT_ERROR_CODES.filter((c) => !seen.has(c))).toEqual(['row_limit']);
    // No cell value in the answer or in any log line.
    for (const cell of [
      'Imported stem',
      'Alpha choice',
      'Not A Skill',
      'essay',
      'Twice',
      'Only one',
    ]) {
      expect(text).not.toContain(cell);
    }
    expect(logs).toEqual([]);
    // Bad rows are sent as codes only (the database stores codes, never cells).
    const stored = (db.tables.import_row_errors ?? []).map((e) => Object.keys(e).sort().join());
    expect(new Set(stored)).toEqual(new Set(['error_code,field,import_job_id,org_id,row_no']));
  });

  it('sends a valid row with the R5-49 a hash over letter option ids and its stored image key', async () => {
    const { call, db } = await setup();
    await call('POST', `/imports/${JOB}/rows`, {
      rows: [mcq(18, { imageSha256: IMG_OK, imageAlt: 'A synthetic chart' })],
    });
    const stored = (db.tables.item_versions ?? []).find((v) => v.import_row_no === 18);
    const sent = stored?.sent as Record<string, unknown>;
    expect(sent.imageKey).toBe(`item-media/${ORG}/${IMG_OK}.png`);
    expect(sent.contentSha256).toBe(
      await itemContentSha256({
        format: 'mcq',
        stem: '[synthetic] Imported stem 18',
        options: [
          { id: 'a', text: 'Alpha choice' },
          { id: 'b', text: 'Beta choice' },
        ],
        media: [{ key: `item-media/${ORG}/${IMG_OK}.png`, alt: 'A synthetic chart' }],
        paramSpec: null,
      }),
    );
  });

  it('generates the variants of a parameterised row before the batch', async () => {
    const { call, db } = await setup();
    const spec = { ...tinySpec, params: { a: { kind: 'int', min: 1, max: 50, step: 1 } } };
    const res = await call('POST', `/imports/${JOB}/rows`, {
      rows: [mcq(19, { paramSpec: spec })],
    });
    expect(ImportRowsResponse.parse(await res.json()).accepted).toBe(1);
    const sent = (db.tables.item_versions ?? []).find((v) => v.import_row_no === 19)?.sent as {
      variants: { variantNo: number; difficulty: number; correctOptionId: string }[];
    };
    expect(sent.variants.map((v) => v.variantNo)).toEqual([1, 2, 3, 4, 5]);
    expect(sent.variants.every((v) => v.difficulty === 0.3 && v.correctOptionId === 'a')).toBe(
      true,
    );
  });

  it('is idempotent on the row number (E13): a re-sent batch answers the same', async () => {
    const { call } = await setup();
    const rows = [mcq(2), mcq(3, { format: 'essay' })];
    const first = ImportRowsResponse.parse(
      await (await call('POST', `/imports/${JOB}/rows`, { rows })).json(),
    );
    const again = ImportRowsResponse.parse(
      await (await call('POST', `/imports/${JOB}/rows`, { rows })).json(),
    );
    expect(again).toEqual(first);
  });

  it('refuses a malformed batch whole (400): no rows, a repeated or out-of-range row number', async () => {
    const { call } = await setup();
    expect((await call('POST', `/imports/${JOB}/rows`, { rows: [] })).status).toBe(400);
    expect((await call('POST', `/imports/${JOB}/rows`, { rows: [mcq(2), mcq(2)] })).status).toBe(
      400,
    );
    expect((await call('POST', `/imports/${JOB}/rows`, { rows: [mcq(2002)] })).status).toBe(400);
    expect((await call('POST', `/imports/${JOB}/rows`, { rows: [mcq(2)], x: 1 })).status).toBe(400);
  });

  it('answers 409 for a job that has ended and 404 for an unknown job', async () => {
    const ended = importsSetup({ status: 'completed' });
    const res = await ended.call('POST', `/imports/${JOB}/rows`, { rows: [mcq(2)] });
    expect(res.status).toBe(409);
    const s = importsSetup();
    const unknown = await s.call('POST', '/imports/c8000000-0000-4000-8000-0000000000ff/rows', {
      rows: [mcq(2)],
    });
    expect(unknown.status).toBe(404);
  });
});
