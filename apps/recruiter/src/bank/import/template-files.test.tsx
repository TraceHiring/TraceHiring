// @vitest-environment happy-dom
// S3 (spec §6.9, M1-9): Trace publishes trace-items-v1.xlsx and trace-items-v1.docx. They are built in the browser from
// the stream's own template definition, so what the screen offers is exactly what the parsers read: each file parses
// into the one synthetic example row with no problem, and the choose screen offers both downloads.
import { unzipSync, strFromU8 } from 'fflate';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../api/runtime';
import { downloadTemplate, type DownloadEnv } from './csv-download';
import { asFile, inProcessWorker } from './fixtures.test-helpers';
import { ImportRoute } from './ImportRoute';
import { ImportView, type ImportHandlers } from './ImportView';
import { parseImport } from './parse';
import { ITEM_HEADERS, SHEET_NAME, TEMPLATE_EXAMPLE } from './template';
import { TEMPLATE_FILES, TEMPLATE_MIME, buildTemplateFile } from './template-files';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const deps = { createWorker: inProcessWorker() };
const EXAMPLE_ROW = {
  rowNo: 2,
  format: 'mcq',
  skillKey: TEMPLATE_EXAMPLE.skill,
  difficulty: Number(TEMPLATE_EXAMPLE.difficulty),
  stem: TEMPLATE_EXAMPLE.stem,
  options: [TEMPLATE_EXAMPLE.option_a, TEMPLATE_EXAMPLE.option_b, TEMPLATE_EXAMPLE.option_c],
  correct: TEMPLATE_EXAMPLE.correct,
};

describe('the template files', () => {
  it('are named as the spec names them', () => {
    expect(TEMPLATE_FILES).toEqual({
      xlsx: 'trace-items-v1.xlsx',
      docx: 'trace-items-v1.docx',
    });
    expect(TEMPLATE_MIME.xlsx).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(TEMPLATE_MIME.docx).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('the example row is clearly synthetic and fits the template', () => {
    expect(TEMPLATE_EXAMPLE.stem).toMatch(/example/i);
    expect(Object.keys(TEMPLATE_EXAMPLE).sort()).toEqual([...ITEM_HEADERS].sort());
  });

  it('the xlsx has the Items sheet with the fixed header row, and parses into exactly the example row', async () => {
    const bytes = buildTemplateFile('xlsx');
    const parts = unzipSync(bytes);
    const workbook = strFromU8(parts['xl/workbook.xml'] ?? new Uint8Array());
    expect(workbook).toContain(`name="${SHEET_NAME}"`);
    const sheet = strFromU8(parts['xl/worksheets/sheet1.xml'] ?? new Uint8Array());
    const headerRow = /<row r="1">([\s\S]*?)<\/row>/.exec(sheet)?.[1] ?? '';
    const headers = [...headerRow.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]);
    expect(headers).toEqual([...ITEM_HEADERS]);

    const outcome = await parseImport(
      { file: asFile(bytes, TEMPLATE_FILES.xlsx), imagesZip: null },
      deps,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.parsed.sourceKind).toBe('xlsx');
    expect(outcome.parsed.issues).toEqual([]);
    expect(outcome.parsed.rows).toEqual([EXAMPLE_ROW]);
    expect(outcome.parsed.rowsRead).toBe(1);
  });

  it('the docx has the styles the parser reads, and parses into exactly the example row', async () => {
    const bytes = buildTemplateFile('docx');
    const parts = unzipSync(bytes);
    const styles = strFromU8(parts['word/styles.xml'] ?? new Uint8Array());
    for (const name of ['heading 2', 'Trace Meta', 'Trace Stem', 'Trace Option', 'Trace Correct']) {
      expect(styles, name).toContain(`w:val="${name}"`);
    }

    const outcome = await parseImport(
      { file: asFile(bytes, TEMPLATE_FILES.docx), imagesZip: null },
      deps,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.parsed.sourceKind).toBe('docx');
    expect(outcome.parsed.issues).toEqual([]);
    expect(outcome.parsed.rows).toEqual([EXAMPLE_ROW]);
    expect(outcome.parsed.rowsRead).toBe(1);
  });

  it('are the same bytes every time they are built (nothing is time dependent)', () => {
    expect(buildTemplateFile('xlsx')).toEqual(buildTemplateFile('xlsx'));
    expect(buildTemplateFile('docx')).toEqual(buildTemplateFile('docx'));
  });
});

describe('downloadTemplate', () => {
  it.each(['xlsx', 'docx'] as const)(
    'saves the %s through a Blob link and revokes the URL at once',
    (kind) => {
      const log: string[] = [];
      const link = {
        href: '',
        download: '',
        click() {
          log.push(`click ${this.href} ${this.download}`);
        },
      };
      const env: DownloadEnv = {
        createObjectURL: (blob) => {
          log.push(`create ${blob.type} ${blob.size > 100 ? 'bytes' : 'tiny'}`);
          return 'blob:synthetic';
        },
        revokeObjectURL: (url) => log.push(`revoke ${url}`),
        createLink: () => link,
      };
      downloadTemplate(kind, env);
      expect(log).toEqual([
        `create ${TEMPLATE_MIME[kind]} bytes`,
        `click blob:synthetic ${TEMPLATE_FILES[kind]}`,
        'revoke blob:synthetic',
      ]);
    },
  );
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label) ?? null;

describe('the choose screen offers both templates', () => {
  it('has two Download the template buttons that ask for the xlsx and the docx', async () => {
    const asked: string[] = [];
    const noop = () => undefined;
    const handlers: ImportHandlers = {
      onFile: noop,
      onZip: noop,
      onCheck: noop,
      onStart: noop,
      onChooseAnother: noop,
      onTryAgain: noop,
      onFinish: noop,
      onCancel: noop,
      onDownloadErrors: noop,
      onDownloadTemplate: (kind) => asked.push(kind),
    };
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <ImportView
            screen={{
              kind: 'choose',
              fileName: null,
              zipName: null,
              checking: false,
              failure: null,
            }}
            handlers={handlers}
          />
        </MemoryRouter>,
      );
    });
    const xlsx = button('Download the template (.xlsx)');
    const docx = button('Download the template (.docx)');
    expect(xlsx).not.toBeNull();
    expect(docx).not.toBeNull();
    await act(async () => {
      xlsx?.click();
      docx?.click();
    });
    expect(asked).toEqual(['xlsx', 'docx']);
  });

  it('on the route, pressing one saves the file through an object URL that is revoked after the click', async () => {
    const created: Blob[] = [];
    const revoked: string[] = [];
    const clicked: string[] = [];
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      created.push(blob as Blob);
      return 'blob:synthetic-template';
    };
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(`${this.download} ${this.href}`);
      expect(revoked).toEqual([]); // revoked after the click, not before
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <ApiContext value={null}>
            <ImportRoute createWorker={inProcessWorker()} />
          </ApiContext>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      button('Download the template (.docx)')?.click();
    });
    expect(created).toHaveLength(1);
    expect(created[0]?.type).toBe(TEMPLATE_MIME.docx);
    expect(clicked).toHaveLength(1);
    expect(clicked[0]).toContain(TEMPLATE_FILES.docx);
    expect(revoked).toEqual(['blob:synthetic-template']);
  });
});
