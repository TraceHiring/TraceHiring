// AT-M1-11 (spec §12, R5-27): every bad row is rendered with its row, its column and its reason; the screen carries no
// cell value, no HTML from the file, and none of the words the M1 guards ban. Rendering is server-side (no DOM needed).
import { IMPORT_ERROR_CODES } from '@trace/shared/contracts/m1';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ERROR_CSV_HEADER, errorCsv } from './error-csv';
import { ERRORS_PER_PAGE, ErrorsTable, ImportView, type Screen } from './ImportView';
import type { RunState } from './run';
import type { RowIssue } from './rows';
import { ITEM_HEADERS, type ImportField } from './template';
import {
  FAILURE_CODES,
  FIELD_LABEL,
  ROW_ERROR_TEXT,
  failureText,
  fieldLabel,
  rowErrorText,
} from './texts';

const noop = () => undefined;
const handlers = {
  onFile: noop,
  onZip: noop,
  onCheck: noop,
  onStart: noop,
  onChooseAnother: noop,
  onTryAgain: noop,
  onFinish: noop,
  onCancel: noop,
  onDownloadErrors: noop,
};
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;|&#x27;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
const render = (screen: Screen) =>
  renderToString(
    <MemoryRouter>
      <ImportView screen={screen} handlers={handlers} />
    </MemoryRouter>,
  );
const buttons = (html: string) =>
  [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1] ?? '').trim());

const FIELDS = Object.keys(FIELD_LABEL) as ImportField[];

describe('the errors table', () => {
  const issues: RowIssue[] = [
    { rowNo: 2, field: 'stem', code: 'missing_field' },
    { rowNo: 7, field: 'correct', code: 'bad_key' },
    { rowNo: 7, field: 'option_b', code: 'too_long' },
    { rowNo: 130, field: 'image_file', code: 'image_missing' },
  ];

  it('renders every bad row with its row number, its column and its reason, in order', () => {
    const html = renderToString(<ErrorsTable issues={issues} />);
    const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => text(m[1] ?? ''));
    expect(rows[0]).toContain('Row');
    expect(rows[0]).toContain('Column');
    expect(rows[0]).toContain('Problem');
    expect(rows.slice(1)).toHaveLength(issues.length);
    expect(rows[1]).toContain('2');
    expect(rows[1]).toContain('Question text');
    expect(rows[1]).toContain(ROW_ERROR_TEXT.missing_field);
    expect(rows[2]).toContain('7');
    expect(rows[2]).toContain('Correct answer');
    expect(rows[2]).toContain(ROW_ERROR_TEXT.bad_key);
    expect(rows[3]).toContain('Option B');
    expect(rows[3]).toContain(ROW_ERROR_TEXT.too_long);
    expect(rows[4]).toContain('130');
    expect(rows[4]).toContain('Image file');
    expect(rows[4]).toContain(ROW_ERROR_TEXT.image_missing);
  });

  it('has a reason for every error code and a label for every column', () => {
    for (const code of IMPORT_ERROR_CODES) {
      expect(ROW_ERROR_TEXT[code], code).toMatch(/\S{3}/);
      expect(rowErrorText(code)).toBe(ROW_ERROR_TEXT[code]);
    }
    for (const header of ITEM_HEADERS) expect(FIELDS, header).toContain(header);
    for (const field of FIELDS) expect(fieldLabel(field), field).toMatch(/\S/);
    const all: RowIssue[] = IMPORT_ERROR_CODES.flatMap((code, i) =>
      FIELDS.map((field) => ({ rowNo: 2 + i, field, code })),
    );
    const html = renderToString(<ErrorsTable issues={all} />);
    expect([...html.matchAll(/<tr\b/g)]).toHaveLength(Math.min(all.length, ERRORS_PER_PAGE) + 1);
  });

  it('shows one page of problems and says which ones, when there are very many (the pages reach all of them)', () => {
    const many: RowIssue[] = Array.from({ length: ERRORS_PER_PAGE * 5 + 25 }, (_, i) => ({
      rowNo: i + 2,
      field: 'stem' as const,
      code: 'too_long' as const,
    }));
    const html = renderToString(<ErrorsTable issues={many} />);
    expect(ERRORS_PER_PAGE).toBe(100);
    expect([...html.matchAll(/<tr\b/g)]).toHaveLength(ERRORS_PER_PAGE + 1);
    expect(text(html)).toContain(`Showing 1–${ERRORS_PER_PAGE} of ${many.length}`);
    expect(buttons(html)).toEqual(['Previous', 'Next']);
    expect(errorCsv(many).trim().split('\r\n')).toHaveLength(many.length + 1);
  });

  it('renders nothing for no errors', () => {
    expect(renderToString(<ErrorsTable issues={[]} />)).toBe('');
  });

  it('shows no text beyond fixed labels, whatever the file said', () => {
    const html = renderToString(<ErrorsTable issues={issues} />);
    for (const word of text(html).split(' ')) expect(word).not.toMatch(/[<>]/);
  });
});

describe('the error CSV (made in the browser from the codes)', () => {
  it('has a header and one quoted line per error, with the code and the reason, and no value', () => {
    const csv = errorCsv([
      { rowNo: 3, field: 'stem', code: 'too_long' },
      { rowNo: 9, field: 'param_spec_json', code: 'bad_param_spec' },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(ERROR_CSV_HEADER);
    expect(lines[1]).toBe(`3,"Question text","too_long","${ROW_ERROR_TEXT.too_long}"`);
    expect(lines[2]).toBe(`9,"Parameter spec","bad_param_spec","${ROW_ERROR_TEXT.bad_param_spec}"`);
    expect(lines[3]).toBe('');
  });

  it('is only the header for no errors', () => {
    expect(errorCsv([])).toBe(`${ERROR_CSV_HEADER}\r\n`);
  });
});

const baseRun: RunState = {
  phase: 'running',
  stage: 'rows',
  jobId: '33333333-3333-4333-8333-333333333333',
  imagesDone: 2,
  imagesTotal: 5,
  rowsSent: 100,
  rowsTotal: 250,
  accepted: 98,
  issues: [{ rowNo: 4, field: 'correct', code: 'bad_key' }],
  failure: null,
  job: null,
};
const run = (
  over: Partial<RunState>,
  extra: Partial<Extract<Screen, { kind: 'run' }>> = {},
): Screen => ({
  kind: 'run',
  sourceKind: 'xlsx',
  fileName: 'items.xlsx',
  rowsRead: 251,
  state: { ...baseRun, ...over },
  ...extra,
});
const job = {
  id: baseRun.jobId ?? '',
  workspaceId: '44444444-4444-4444-8444-444444444444',
  sourceKind: 'xlsx' as const,
  templateVersion: 'trace-items-v1' as const,
  status: 'completed' as const,
  rowsTotal: 250,
  rowsOk: 249,
  rowsError: 1,
  imagesOk: 5,
  createdAt: '2026-10-23T10:00:00.000Z',
  completedAt: '2026-10-23T10:05:00.000Z',
};

const SCREENS: [string, Screen][] = [
  ['choose', { kind: 'choose', fileName: null, zipName: null, checking: false, failure: null }],
  [
    'choose with a failure',
    { kind: 'choose', fileName: 'a.xlsx', zipName: null, checking: false, failure: 'macro_file' },
  ],
  [
    'choose, checking',
    { kind: 'choose', fileName: 'a.xlsx', zipName: 'p.zip', checking: true, failure: null },
  ],
  [
    'checked',
    {
      kind: 'checked',
      sourceKind: 'xlsx',
      fileName: 'items.xlsx',
      rowsRead: 12,
      rowsReady: 10,
      imagesInFile: 3,
      issues: [
        { rowNo: 4, field: 'stem', code: 'missing_field' },
        { rowNo: 8, field: 'options', code: 'bad_options' },
      ],
    },
  ],
  [
    'checked, nothing to import',
    {
      kind: 'checked',
      sourceKind: 'docx',
      fileName: 'items.docx',
      rowsRead: 1,
      rowsReady: 0,
      imagesInFile: 0,
      issues: [{ rowNo: 2, field: 'format', code: 'missing_field' }],
    },
  ],
  ['running', run({})],
  ['running, job', run({ stage: 'job', jobId: null })],
  ['running, images', run({ stage: 'images' })],
  ['ready', run({ phase: 'ready', stage: null, rowsSent: 250 })],
  ['ready, no errors', run({ phase: 'ready', stage: null, rowsSent: 250, issues: [] })],
  ['ready, nothing sent', run({ phase: 'ready', stage: null, rowsSent: 0, rowsTotal: 0 })],
  ['stopped', run({ phase: 'stopped', stage: null, failure: 'unavailable' })],
  ['stopped, aal2', run({ phase: 'stopped', stage: null, failure: 'aal2_required', jobId: null })],
  ['completing', run({ phase: 'completing', stage: null })],
  ['cancelling', run({ phase: 'cancelling', stage: null })],
  ['completed', run({ phase: 'completed', stage: null, job, rowsSent: 250 })],
  ['cancelled', run({ phase: 'cancelled', stage: null, job: { ...job, status: 'cancelled' } })],
  ['failed', run({ phase: 'failed', stage: null, failure: 'timeout' })],
  [
    'docx',
    run(
      { phase: 'ready', stage: null, rowsSent: 250 },
      { sourceKind: 'docx', fileName: 'items.docx' },
    ),
  ],
];

describe('the import screen', () => {
  it.each(SCREENS)('%s keeps the Import items heading', (_name, screen) => {
    expect(render(screen)).toContain('<h2');
    expect(text(render(screen))).toContain('Import items');
  });

  it('the choose screen has the two pickers and a Check file button that waits for a file', () => {
    const html = render(SCREENS[0]?.[1] as Screen);
    expect(html).toContain('type="file"');
    expect(text(html)).toContain('Items file (.xlsx or .docx)');
    expect(text(html)).toContain('Images zip (optional, for .xlsx)');
    expect(text(html)).toContain('trace-items-v1');
    const check = /<button\b[^>]*>\s*Check file/.exec(html);
    expect(check?.[0]).toContain('disabled');
    const withFile = render({
      kind: 'choose',
      fileName: 'a.xlsx',
      zipName: null,
      checking: false,
      failure: null,
    });
    expect(/<button\b[^>]*>\s*Check file/.exec(withFile)?.[0]).not.toContain('disabled');
  });

  it('shows the fixed text of a refused file, never anything from the file', () => {
    const html = render({
      kind: 'choose',
      fileName: 'a.xlsx',
      zipName: null,
      checking: false,
      failure: 'macro_file',
    });
    expect(text(html)).toContain(failureText('macro_file'));
    expect(html).toContain('role="alert"');
  });

  it('checked: counts rows, shows every problem row, and starts only when something can be imported', () => {
    const html = render(SCREENS[3]?.[1] as Screen);
    const body = text(html);
    expect(body).toContain('Rows in the file: 12');
    expect(body).toContain('Ready to import: 10');
    expect(body).toContain('Rows with problems: 2');
    expect(body).toContain('Images found: 3');
    expect(body).toContain(ROW_ERROR_TEXT.missing_field);
    expect(body).toContain(ROW_ERROR_TEXT.bad_options);
    expect(buttons(html)).toEqual(expect.arrayContaining(['Start import', 'Choose another file']));
    const empty = render(SCREENS[4]?.[1] as Screen);
    expect(/<button\b[^>]*>\s*Start import/.exec(empty)?.[0]).toContain('disabled');
    expect(text(empty)).toContain(failureText('nothing_to_import'));
    expect(text(empty)).toContain('row 2 is the first Heading 2 item');
  });

  it('running: shows the stage and progress, and offers Cancel import only', () => {
    const html = render(run({}));
    expect(text(html)).toContain('Rows: 100 of 250');
    expect(text(html)).toContain('Images: 2 of 5');
    expect(buttons(html)).toEqual(['Cancel import']);
  });

  it('ready: offers Finish import, Cancel import and the error list, and shows the problems', () => {
    const html = render(run({ phase: 'ready', stage: null, rowsSent: 250 }));
    expect(buttons(html)).toEqual([
      'Finish import',
      'Cancel import',
      'Download the error list (CSV)',
    ]);
    expect(text(html)).toContain('Rows accepted: 98');
    expect(text(html)).toContain(ROW_ERROR_TEXT.bad_key);
    expect(
      buttons(render(run({ phase: 'ready', stage: null, rowsSent: 250, issues: [] }))),
    ).toEqual(['Finish import', 'Cancel import']);
  });

  it('ready with nothing sent cannot be finished, only cancelled', () => {
    const html = render(run({ phase: 'ready', stage: null, rowsSent: 0, rowsTotal: 0 }));
    expect(buttons(html)).not.toContain('Finish import');
    expect(buttons(html)).toContain('Cancel import');
  });

  it('stopped: shows the fixed text of the failure, and Try again and Cancel import', () => {
    const html = render(run({ phase: 'stopped', stage: null, failure: 'unavailable' }));
    expect(text(html)).toContain(failureText('unavailable'));
    expect(buttons(html)).toEqual(expect.arrayContaining(['Try again', 'Cancel import']));
    expect(html).toContain('role="alert"');
  });

  it('completed and cancelled say what stays; cancelled keeps the imported rows', () => {
    const done = text(render(run({ phase: 'completed', stage: null, job, rowsSent: 250 })));
    expect(done).toContain('Import finished');
    expect(done).toContain('Questions imported: 249');
    expect(done).toContain('Go to the item bank');
    const cancelled = text(
      render(run({ phase: 'cancelled', stage: null, job: { ...job, status: 'cancelled' } })),
    );
    expect(cancelled).toContain('Import cancelled');
    expect(cancelled).toContain('Rows already imported stay in your bank');
  });

  it('failed shows the job failure in words', () => {
    expect(text(render(run({ phase: 'failed', stage: null, failure: 'timeout' })))).toContain(
      failureText('timeout'),
    );
  });

  it('has fixed text for every failure the flow can end in', () => {
    const codes = [
      ...FAILURE_CODES,
      'aal2_required',
      'unauthorized',
      'not_found',
      'conflict',
      'bad_request',
      'rate_limited',
    ];
    for (const code of codes) {
      expect(failureText(code), code).toMatch(/\S{3}/);
      expect(failureText(code), code).not.toContain(code.includes('_') ? code : '\u0000');
    }
    expect(failureText('something_new')).toMatch(/\S{3}/);
  });

  it('draws file names only as escaped text', () => {
    const hostile = '<img src=x onerror=alert(1)>.xlsx';
    const html = render({
      kind: 'choose',
      fileName: hostile,
      zipName: '"><script>alert(2)</script>.zip',
      checking: false,
      failure: null,
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img');
    expect(html).not.toMatch(/\sstyle=/);
  });

  it('uses none of the words the M1 guards ban, has no selection control, and no band wording', () => {
    const CONTROL =
      /\b(?:reject\w*|decline\w*|shortlist\w*|decision\w*|confirm\w*|overturn\w*|notice\w*|appeal\w*)\b/i;
    const COMBINED = /\b(?:overall|combined|total|trust|honesty|composite)\b/i;
    const NEVER =
      /\b(?:gaze|ASN|IPv?[46]?)\b|\bIP[\s _-]*address(?:es)?\b|\bemotion|face.?match|\bdevice\b|\bpersonality\b|voiceprint|biometric|likeness|solvab\w*|\bbulk\b/i;
    const BAND = /\b(?:Clear|Review suggested|Strong concern|Insufficient evidence)\b|\bband\b/i;
    for (const [name, screen] of SCREENS) {
      const html = render(screen);
      const body = text(html);
      for (const re of [CONTROL, COMBINED, NEVER, BAND]) expect(body, name).not.toMatch(re);
      expect(html, name).not.toMatch(/type="checkbox"|role="checkbox"|aria-selected|role="option"/);
    }
    for (const text_ of [...Object.values(ROW_ERROR_TEXT), ...FAILURE_CODES.map(failureText)]) {
      for (const re of [CONTROL, COMBINED, NEVER, BAND]) expect(text_).not.toMatch(re);
    }
  });
});
