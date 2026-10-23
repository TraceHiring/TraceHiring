// @vitest-environment happy-dom
// AT-M1-11 (spec §12): xlsx + docx fixtures, caps, formulas not evaluated, macro files refused, and a row error for
// every bad row (never a silent drop). Fixtures are tiny synthetic files built in memory; every value is synthetic.
// Rows that the api alone can judge (duplicate_in_file, duplicate_in_bank, variant_generation_failed, and the
// skill-taxonomy half of bad_skill) are not decided on the page and are tested in services/api.
import { createHash } from 'node:crypto';
import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  asFile,
  docxBytes,
  inProcessWorker,
  itemRow,
  jpegBytes,
  mcqDocxItem,
  mcqRow,
  pngBytes,
  webpBytes,
  writtenRow,
  xlsxBytes,
  zipBytes,
  type Cell,
  type DocxItem,
  type DocxOptions,
  type SheetRow,
  type XlsxOptions,
} from './fixtures.test-helpers';
import { IMPORT_LIMITS, type ImportLimits } from './limits';
import { parseImport, type ParsedImport } from './parse';
import type { ItemHeader } from './template';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const deps = { createWorker: inProcessWorker() };
const depsWith = (lim: ImportLimits) => ({ createWorker: inProcessWorker(lim), limits: lim });
const limits = (over: Partial<ImportLimits>): ImportLimits => ({ ...IMPORT_LIMITS, ...over });

async function readXlsx(
  rows: SheetRow[],
  options: XlsxOptions = {},
  imagesZip: Uint8Array<ArrayBuffer> | null = null,
  lim: ImportLimits = IMPORT_LIMITS,
) {
  return parseImport(
    {
      file: asFile(xlsxBytes(rows, options), 'items.xlsx'),
      imagesZip: imagesZip === null ? null : asFile(imagesZip, 'pics.zip'),
    },
    depsWith(lim),
  );
}
async function readDocx(items: DocxItem[], options: DocxOptions = {}) {
  return parseImport(
    { file: asFile(docxBytes(items, options), 'items.docx'), imagesZip: null },
    deps,
  );
}
async function parsed(outcome: ReturnType<typeof readXlsx>): Promise<ParsedImport> {
  const result = await outcome;
  if (!result.ok) throw new Error(`parse failed: ${result.code}`);
  return result.parsed;
}
const issueSet = (p: ParsedImport) => p.issues.map((i) => `${i.rowNo}:${i.field}:${i.code}`).sort();

describe('xlsx: good files', () => {
  it('reads multiple-choice and written rows into ImportRow values with the sheet row numbers', async () => {
    const p = await parsed(readXlsx([mcqRow(1), writtenRow(2), mcqRow(3, { difficulty: '0.75' })]));
    expect(p.issues).toEqual([]);
    expect(p.sourceKind).toBe('xlsx');
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0]).toEqual({
      rowNo: 2,
      format: 'mcq',
      skillKey: 'quant',
      difficulty: 0.5,
      stem: '[synthetic] Question 1: pick the second option.',
      options: ['[synthetic] first 1', '[synthetic] second 1', '[synthetic] third 1'],
      correct: 'b',
    });
    expect(p.rows[1]).toEqual({
      rowNo: 3,
      format: 'written',
      skillKey: 'writing',
      difficulty: 0.4,
      stem: '[synthetic] Describe topic 2 in two sentences.',
      rubricKey: 'clarity-v1',
    });
    expect(p.rows[2]).toMatchObject({ rowNo: 4, difficulty: 0.75 });
    expect(p.rowsRead).toBe(3);
  });

  it('reads inline strings, any column order, upper-case format and letter, and skips blank rows keeping row numbers', async () => {
    const shuffled = [
      'stem',
      'format',
      'skill',
      'difficulty',
      'correct',
      'option_b',
      'option_a',
      'rubric_key',
      'image_file',
      'image_alt',
      'param_spec_json',
      'option_c',
      'option_d',
      'option_e',
      'option_f',
    ];
    const row: SheetRow = [
      '[synthetic] shuffled',
      'MCQ',
      'quant',
      '0.3',
      'A',
      'two',
      'one',
      ...Array<Cell>(8).fill(null),
    ];
    const p = await parsed(
      readXlsx([[...row], [null, null, null], [...row]], {
        headers: shuffled,
        inlineStrings: true,
      }),
    );
    expect(p.issues).toEqual([]);
    expect(p.rows.map((r) => r.rowNo)).toEqual([2, 4]);
    expect(p.rows[0]).toMatchObject({ format: 'mcq', options: ['one', 'two'], correct: 'a' });
  });

  it('finds the Items sheet when it is not the first sheet', async () => {
    const p = await parsed(readXlsx([mcqRow(1)], { decoySheet: true }));
    expect(p.rows).toHaveLength(1);
  });

  it('uses the cached value of a formula cell and never evaluates it (E9)', async () => {
    const p = await parsed(
      readXlsx([
        mcqRow(1, { stem: { f: 'HYPERLINK("https://example.invalid","x")', v: 'cached stem' } }),
      ]),
    );
    expect(p.rows[0]).toMatchObject({ stem: 'cached stem' });
  });

  it('keeps HTML and script text in a stem as plain text (E10)', async () => {
    const evil = '<img src=x onerror=alert(1)> <script>alert(2)</script> & more';
    const p = await parsed(readXlsx([mcqRow(1, { stem: evil })]));
    expect(p.rows[0]).toMatchObject({ stem: evil });
  });

  it('accepts a parameterised multiple-choice row', async () => {
    const spec = {
      params: {
        a: { kind: 'int', min: 2, max: 9, step: 1 },
        b: { kind: 'int', min: 2, max: 9, step: 1 },
      },
      derived: { sum: 'a + b' },
      constraints: [],
      stem: 'What is {a} + {b}?',
      options: [
        { id: 'x', text: '{sum}' },
        { id: 'y', text: '{sum} + 1' },
      ],
      correctOptionId: 'x',
      count: 5,
    };
    const p = await parsed(readXlsx([mcqRow(1, { param_spec_json: JSON.stringify(spec) })]));
    expect(p.issues).toEqual([]);
    expect(p.rows[0]).toMatchObject({ paramSpec: { count: 5 } });
  });
});

describe('xlsx: every bad row gets a row, a field and a code (AT-M1-11)', () => {
  const bad = (n: number, cells: Partial<Record<ItemHeader, Cell>>) =>
    itemRow({ ...mcqRowValues(n), ...cells });
  function mcqRowValues(n: number): Partial<Record<ItemHeader, Cell>> {
    return {
      format: 'mcq',
      skill: 'quant',
      difficulty: 0.5,
      stem: `[synthetic] q${n}`,
      option_a: 'one',
      option_b: 'two',
      correct: 'a',
    };
  }

  const cases: [string, Partial<Record<ItemHeader, Cell>>, string][] = [
    ['blank stem', { stem: null }, 'stem:missing_field'],
    ['blank format', { format: null }, 'format:missing_field'],
    ['unknown format', { format: 'essay' }, 'format:bad_format'],
    ['blank skill', { skill: null }, 'skill:missing_field'],
    ['skill not a key', { skill: 'Quant Skills' }, 'skill:bad_skill'],
    ['blank difficulty', { difficulty: null }, 'difficulty:missing_field'],
    ['difficulty above 1', { difficulty: 1.5 }, 'difficulty:bad_difficulty'],
    ['difficulty below 0', { difficulty: -0.1 }, 'difficulty:bad_difficulty'],
    ['difficulty text', { difficulty: 'hard' }, 'difficulty:bad_difficulty'],
    ['difficulty not a multiple of 0.01', { difficulty: 0.555 }, 'difficulty:bad_difficulty'],
    ['stem over 4000', { stem: 'x'.repeat(4001) }, 'stem:too_long'],
    ['no options', { option_a: null, option_b: null }, 'options:missing_field'],
    ['one option', { option_b: null }, 'options:bad_options'],
    ['gap in the options', { option_b: null, option_c: 'three' }, 'options:bad_options'],
    ['option over 500', { option_b: 'y'.repeat(501) }, 'option_b:too_long'],
    ['blank key', { correct: null }, 'correct:missing_field'],
    ['key not a letter', { correct: 'z' }, 'correct:bad_key'],
    ['key beyond the options', { correct: 'e' }, 'correct:bad_key'],
    ['param spec not JSON', { param_spec_json: '{not json' }, 'param_spec_json:bad_param_spec'],
    [
      'param spec wrong shape',
      { param_spec_json: '{"count": 5}' },
      'param_spec_json:bad_param_spec',
    ],
    [
      'image name climbing out',
      { image_file: '../x.png', image_alt: 'a' },
      'image_file:bad_image_ref',
    ],
    [
      'image not in the zip',
      { image_file: 'nope.png', image_alt: 'a' },
      'image_file:image_missing',
    ],
    ['alt without an image', { image_alt: 'a' }, 'image_file:missing_field'],
    ['alt over 300', { image_file: 'ok.png', image_alt: 'a'.repeat(301) }, 'image_alt:too_long'],
    ['image without alt', { image_file: 'ok.png' }, 'image_alt:missing_field'],
  ];

  it.each(cases)('%s', async (_label, cells, expected) => {
    const zip = zipBytes({ 'ok.png': pngBytes(1) });
    const p = await parsed(readXlsx([bad(1, cells)], {}, zip));
    expect(p.rows).toEqual([]);
    expect(issueSet(p)).toEqual([`2:${expected}`]);
  });

  it('written rows: blank or malformed rubric key, and a param spec that does not belong', async () => {
    const p = await parsed(
      readXlsx([
        writtenRow(1, { rubric_key: null }),
        writtenRow(2, { rubric_key: 'Bad Key!' }),
        writtenRow(3, { param_spec_json: '{}' }),
      ]),
    );
    expect(issueSet(p)).toEqual([
      '2:rubric_key:missing_field',
      '3:rubric_key:bad_format',
      '4:param_spec_json:bad_param_spec',
    ]);
  });

  it('keeps the good rows and reports the bad ones in the same file, none dropped', async () => {
    const p = await parsed(
      readXlsx([
        mcqRow(1),
        bad(2, { correct: 'z' }),
        mcqRow(3),
        bad(4, { stem: null, skill: null }),
      ]),
    );
    expect(p.rows.map((r) => r.rowNo)).toEqual([2, 4]);
    expect(issueSet(p)).toEqual([
      '3:correct:bad_key',
      '5:skill:missing_field',
      '5:stem:missing_field',
    ]);
    expect(p.rowsRead).toBe(4);
  });

  it('a row with several problems reports each field once', async () => {
    const p = await parsed(readXlsx([bad(1, { skill: null, difficulty: 7, correct: 'q' })]));
    expect(issueSet(p)).toEqual([
      '2:correct:bad_key',
      '2:difficulty:bad_difficulty',
      '2:skill:missing_field',
    ]);
  });

  it('carries no cell value in any issue', async () => {
    const p = await parsed(
      readXlsx([bad(1, { stem: 'SECRET-STEM-TEXT'.repeat(400), correct: 'SECRET-KEY' })]),
    );
    expect(JSON.stringify(p.issues)).not.toContain('SECRET');
  });
});

describe('xlsx: images (E11, E12)', () => {
  it('hashes each image once, content-addressed, and shares it between rows (E12)', async () => {
    const one = pngBytes(1);
    const two = jpegBytes(2);
    const three = webpBytes(3);
    const zip = zipBytes({
      'one.png': one,
      'pics/two.JPG': two,
      'three.webp': three,
      'copy.png': one,
    });
    const p = await parsed(
      readXlsx(
        [
          mcqRow(1, { image_file: 'one.png', image_alt: 'a' }),
          mcqRow(2, { image_file: 'ONE.PNG', image_alt: 'b' }),
          mcqRow(3, { image_file: 'two.jpg', image_alt: 'c' }),
          mcqRow(4, { image_file: 'pics/two.jpg', image_alt: 'c' }),
          writtenRow(5, { image_file: 'three.webp', image_alt: 'd' }),
          mcqRow(6, { image_file: 'copy.png', image_alt: 'e' }),
        ],
        {},
        zip,
      ),
    );
    expect(p.issues).toEqual([]);
    expect(p.rows.map((r) => ('imageSha256' in r ? r.imageSha256 : null))).toEqual([
      sha(one),
      sha(one),
      sha(two),
      sha(two),
      sha(three),
      sha(one),
    ]);
    expect(p.images.map((i) => `${i.type}`).sort()).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    expect(p.images).toHaveLength(3);
    expect(p.rows[0]).toMatchObject({ imageAlt: 'a' });
  });

  it('flags an image over 1 MiB (declared) on its rows and still reads the rest', async () => {
    const zip = zipBytes({ 'big.png': pngBytes(1, 2_000_000), 'ok.png': pngBytes(2) });
    const p = await parsed(
      readXlsx(
        [
          mcqRow(1, { image_file: 'big.png', image_alt: 'a' }),
          mcqRow(2, { image_file: 'ok.png', image_alt: 'b' }),
        ],
        {},
        zip,
      ),
    );
    expect(issueSet(p)).toEqual(['2:image_file:image_too_large']);
    expect(p.rows.map((r) => r.rowNo)).toEqual([3]);
  });

  it('flags a file that is not a png, jpeg or webp by its bytes, whatever its name says', async () => {
    const zip = zipBytes({
      'fake.png': strToU8('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      'x.svg': strToU8('<svg/>'),
    });
    const p = await parsed(
      readXlsx(
        [
          mcqRow(1, { image_file: 'fake.png', image_alt: 'a' }),
          mcqRow(2, { image_file: 'x.svg', image_alt: 'b' }),
        ],
        {},
        zip,
      ),
    );
    expect(issueSet(p)).toEqual(['2:image_file:image_bad_type', '3:image_file:image_bad_type']);
  });

  it('an image name that matches two files in different folders is a bad reference', async () => {
    const zip = zipBytes({ 'a/pic.png': pngBytes(1), 'b/pic.png': pngBytes(2) });
    const p = await parsed(
      readXlsx([mcqRow(1, { image_file: 'pic.png', image_alt: 'a' })], {}, zip),
    );
    expect(issueSet(p)).toEqual(['2:image_file:bad_image_ref']);
  });

  it('an image named in a row but no zip given is image_missing', async () => {
    const p = await parsed(readXlsx([mcqRow(1, { image_file: 'pic.png', image_alt: 'a' })]));
    expect(issueSet(p)).toEqual(['2:image_file:image_missing']);
  });
});

describe('xlsx: file-level failures stop before anything is sent', () => {
  const failure = async (outcome: ReturnType<typeof readXlsx>) => {
    const r = await outcome;
    return r.ok ? 'ok' : r.code;
  };

  it('refuses a macro workbook (E9): by extension, by content type and by a vbaProject part', async () => {
    expect(
      (
        await parseImport(
          { file: asFile(xlsxBytes([mcqRow(1)]), 'items.xlsm'), imagesZip: null },
          deps,
        )
      ).ok,
    ).toBe(false);
    expect(
      await failure(
        readXlsx([mcqRow(1)], { extraEntries: { 'xl/vbaProject.bin': new Uint8Array(3) } }),
      ),
    ).toBe('macro_file');
    expect(
      await failure(
        readXlsx([mcqRow(1)], {
          contentTypesExtra:
            '<Override PartName="/x" ContentType="application/vnd.ms-excel.sheet.macroEnabled.12"/>',
        }),
      ),
    ).toBe('macro_file');
  });

  it('refuses a wrong template: no Items sheet, a missing column, no data rows', async () => {
    expect(await failure(readXlsx([mcqRow(1)], { sheetName: 'Sheet1' }))).toBe('bad_template');
    const headers = ['format', 'skill', 'stem'];
    expect(await failure(readXlsx([['mcq', 'quant', 'x']], { headers }))).toBe('bad_template');
    expect(await failure(readXlsx([]))).toBe('no_rows');
    expect(await failure(readXlsx([[null, null], [null]]))).toBe('no_rows');
  });

  it('refuses more rows than the limit (row_limit), counting rows with content only', async () => {
    const rows = [mcqRow(1), mcqRow(2), mcqRow(3), mcqRow(4)];
    expect(await failure(readXlsx(rows, {}, null, limits({ rows: 3 })))).toBe('row_limit');
    expect(await failure(readXlsx(rows, {}, null, limits({ rows: 4 })))).toBe('ok');
  });

  it('refuses a row beyond sheet row 2001', async () => {
    const rows: SheetRow[] = Array.from({ length: 2001 }, () => [null]);
    rows[2000] = mcqRow(1); // sheet row 2002
    expect(await failure(readXlsx(rows))).toBe('row_limit');
  });

  it('refuses malformed XML, a DTD and an entity bomb in the sheet', async () => {
    const good = xlsxBytes([mcqRow(1)]);
    expect(good.length).toBeGreaterThan(0);
    const broken = { 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row></worksheet>' };
    expect(await failure(readXlsx([mcqRow(1)], { extraEntries: broken }))).toBe('bad_xml');
    const dtd = {
      'xl/worksheets/sheet1.xml':
        '<!DOCTYPE x [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><worksheet><sheetData/></worksheet>',
    };
    expect(await failure(readXlsx([mcqRow(1)], { extraEntries: dtd }))).toBe('bad_xml');
  });

  it('aborts a zip bomb inside the sheet with one code (E11)', async () => {
    const bomb = new Uint8Array(3 * 1_048_576);
    const r = await readXlsx(
      [mcqRow(1)],
      { extraEntries: { 'xl/worksheets/sheet1.xml': bomb } },
      null,
      limits({ xmlPartBytes: 1_048_576 }),
    );
    expect(r).toEqual({ ok: false, code: 'archive_too_large' });
  });

  it('aborts a zip bomb in the images zip (E11)', async () => {
    const zip = zipBytes({
      'a.png': pngBytes(1, 3 * 1_048_576),
      'b.txt': new Uint8Array(3 * 1_048_576),
    });
    const r = await readXlsx([mcqRow(1)], {}, zip, limits({ uncompressedBytes: 1_048_576 }));
    expect(r).toEqual({ ok: false, code: 'archive_too_large' });
  });

  it('refuses too many images', async () => {
    const zip = zipBytes({ 'a.png': pngBytes(1), 'b.png': pngBytes(2), 'c.png': pngBytes(3) });
    expect(await failure(readXlsx([mcqRow(1)], {}, zip, limits({ images: 2 })))).toBe(
      'too_many_images',
    );
  });

  it('refuses a file that is not a zip', async () => {
    const r = await parseImport(
      { file: new File([strToU8('hello')], 'items.xlsx'), imagesZip: null },
      deps,
    );
    expect(r).toEqual({ ok: false, code: 'bad_archive' });
  });

  it('refuses a wrong extension on the picked file and on the images zip', async () => {
    expect(
      await parseImport(
        { file: new File([new Uint8Array(4)], 'items.csv'), imagesZip: null },
        deps,
      ),
    ).toEqual({ ok: false, code: 'bad_extension' });
    const r = await parseImport(
      {
        file: asFile(xlsxBytes([mcqRow(1)]), 'items.xlsx'),
        imagesZip: new File([new Uint8Array(4)], 'p.rar'),
      },
      deps,
    );
    expect(r).toEqual({ ok: false, code: 'bad_extension' });
  });

  it('refuses a picked sheet over 10 MiB without reading it', async () => {
    const file = asFile(xlsxBytes([mcqRow(1)]), 'items.xlsx');
    const r = await parseImport(
      { file, imagesZip: null },
      depsWith(limits({ sheetFileBytes: 100 })),
    );
    expect(r).toEqual({ ok: false, code: 'file_too_large' });
  });
});

describe('docx', () => {
  it('reads one item per Heading 2 block, with rows numbered from 2', async () => {
    const p = await parsed(
      readDocx([
        mcqDocxItem(1),
        {
          meta: ['format: written', 'skill: writing', 'difficulty: 0.4', 'rubric_key: clarity-v1'],
          stem: ['[synthetic] Describe topic 2.', 'Second paragraph.'],
        },
      ]),
    );
    expect(p.issues).toEqual([]);
    expect(p.sourceKind).toBe('docx');
    expect(p.rows[0]).toEqual({
      rowNo: 2,
      format: 'mcq',
      skillKey: 'quant',
      difficulty: 0.5,
      stem: '[synthetic] Question 1: pick the second option.',
      options: ['[synthetic] first 1', '[synthetic] second 1', '[synthetic] third 1'],
      correct: 'b',
    });
    expect(p.rows[1]).toMatchObject({
      rowNo: 3,
      format: 'written',
      stem: '[synthetic] Describe topic 2.\nSecond paragraph.',
      rubricKey: 'clarity-v1',
    });
  });

  it('places an inline image with its alt text, and lets a Trace Meta image_alt win', async () => {
    const png = pngBytes(7);
    const p = await parsed(
      readDocx(
        [
          mcqDocxItem(1, { image: { file: 'a.png', alt: 'a plot' } }),
          mcqDocxItem(2, {
            image: { file: 'a.png', alt: 'ignored' },
            meta: ['format: mcq', 'skill: quant', 'difficulty: 0.5', 'image_alt: from meta'],
          }),
        ],
        { images: { 'a.png': png } },
      ),
    );
    expect(p.issues).toEqual([]);
    expect(p.rows[0]).toMatchObject({ imageSha256: sha(png), imageAlt: 'a plot' });
    expect(p.rows[1]).toMatchObject({ imageSha256: sha(png), imageAlt: 'from meta' });
    expect(p.images).toHaveLength(1);
  });

  it('reports each problem of a block with its row', async () => {
    const png = pngBytes(7);
    const items: DocxItem[] = [
      mcqDocxItem(1, { stem: [] }),
      mcqDocxItem(2, {
        meta: ['format: mcq', 'skill: quant', 'difficulty: 0.5', 'dificulty: 0.9'],
      }),
      mcqDocxItem(3, { image: { file: 'a.png' } }),
      mcqDocxItem(4, { image: { file: '@external', alt: 'x' } }),
      mcqDocxItem(5, { image: { file: 'gone.png', alt: 'x' } }),
      mcqDocxItem(6, { correct: 'f' }),
      mcqDocxItem(7, { options: ['only one'], correct: 'a' }),
      mcqDocxItem(8, { options: Array.from({ length: 7 }, (_, i) => `o${i}`), correct: 'a' }),
      { meta: ['skill: quant', 'difficulty: 0.5'], stem: ['no format here'] },
      mcqDocxItem(10, { other: ['text in a style the template does not use'] }),
    ];
    const p = await parsed(readDocx(items, { images: { 'a.png': png } }));
    expect(issueSet(p)).toEqual(
      [
        '10:format:missing_field',
        '2:stem:missing_field',
        '3:row:bad_format',
        '4:image_alt:missing_field',
        '5:image_file:bad_image_ref',
        '6:image_file:bad_image_ref',
        '7:correct:bad_key',
        '8:options:bad_options',
        '9:options:bad_options',
      ].sort(),
    );
    expect(p.rows.map((r) => r.rowNo)).toEqual([11]);
  });

  it('refuses a docx with no styles part, a macro docx and a bad file', async () => {
    expect(await readDocx([mcqDocxItem(1)], { noStyles: true })).toEqual({
      ok: false,
      code: 'bad_template',
    });
    expect(
      await readDocx([mcqDocxItem(1)], {
        extraEntries: { 'word/vbaProject.bin': new Uint8Array(2) },
      }),
    ).toEqual({ ok: false, code: 'macro_file' });
    expect(await readDocx([])).toEqual({ ok: false, code: 'no_rows' });
    expect(
      await parseImport(
        { file: asFile(docxBytes([mcqDocxItem(1)]), 'items.docm'), imagesZip: null },
        deps,
      ),
    ).toEqual({ ok: false, code: 'macro_file' });
  });

  it('refuses more items than the limit', async () => {
    const r = await parseImport(
      {
        file: asFile(docxBytes([mcqDocxItem(1), mcqDocxItem(2), mcqDocxItem(3)]), 'items.docx'),
        imagesZip: null,
      },
      depsWith(limits({ rows: 2 })),
    );
    expect(r).toEqual({ ok: false, code: 'row_limit' });
  });

  it('an inline image over its own 1 MiB cap is a row error; the rest of the file is still read', async () => {
    const r = await readDocx(
      [mcqDocxItem(1, { image: { file: 'a.png', alt: 'x' } }), mcqDocxItem(2)],
      { images: { 'a.png': pngBytes(1, 3 * 1_048_576) } },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(issueSet(r.parsed)).toEqual(['2:image_file:image_too_large']);
      expect(r.parsed.rows.map((row) => row.rowNo)).toEqual([3]);
    }
  });

  it('aborts a media zip bomb with one code (E11)', async () => {
    const bomb = await parseImport(
      {
        file: asFile(
          docxBytes([mcqDocxItem(1)], { images: { 'a.png': pngBytes(1, 3 * 1_048_576) } }),
          'items.docx',
        ),
        imagesZip: null,
      },
      depsWith(limits({ uncompressedBytes: 1_048_576 })),
    );
    expect(bomb).toEqual({ ok: false, code: 'archive_too_large' });
  });
});
