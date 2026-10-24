// @vitest-environment happy-dom
// The import route end to end in a DOM (spec §6.9, AT-M1-11): pick a synthetic xlsx, check it, start, finish; a refused
// file shows its fixed text and creates nothing; cancel keeps the imported rows. The api is a fake fetch behind the
// real client and the real contracts; the worker is the real handler run in this process.
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiClient, type FetchLike } from '../../api/client';
import { ApiContext } from '../../api/runtime';
import { downloadErrorCsv, type DownloadEnv } from './csv-download';
import { ERROR_CSV_NAME } from './error-csv';
import {
  asFile,
  inProcessWorker,
  mcqRow,
  xlsxBytes,
  zipBytes,
  pngBytes,
} from './fixtures.test-helpers';
import { ImportRoute } from './ImportRoute';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORG = '11111111-1111-4111-8111-111111111111';
const JOB = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-10-23T10:00:00.000Z';
const jobJson = (status: string, over: Record<string, unknown> = {}) => ({
  id: JOB,
  workspaceId: '44444444-4444-4444-8444-444444444444',
  sourceKind: 'xlsx',
  templateVersion: 'trace-items-v1',
  status,
  rowsTotal: 0,
  rowsOk: 0,
  rowsError: 0,
  imagesOk: 0,
  createdAt: NOW,
  completedAt: ['completed', 'cancelled', 'failed'].includes(status) ? NOW : null,
  ...over,
});
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch() {
  const calls: { method: string; path: string; body: string }[] = [];
  const impl: FetchLike = (url, init) => {
    const path = new URL(url).pathname.replace(`/v1/orgs/${ORG}`, '');
    const method = init.method ?? 'GET';
    const body =
      typeof init.body === 'string' ? init.body : init.body === undefined ? '' : '<bytes>';
    calls.push({ method, path, body });
    if (method === 'POST' && path === '/imports')
      return Promise.resolve(json(jobJson('open'), 201));
    if (method === 'PUT' && path.includes('/images/')) {
      const sha = path.split('/').pop() ?? '';
      return Promise.resolve(json({ key: `item-media/${ORG}/${sha}.png` }));
    }
    if (path.endsWith('/rows')) {
      const rows = (JSON.parse(body) as { rows: unknown[] }).rows;
      return Promise.resolve(json({ accepted: rows.length, errors: [] }));
    }
    if (path.endsWith('/complete')) {
      return Promise.resolve(json(jobJson('completed', { rowsTotal: 2, rowsOk: 2 })));
    }
    if (path.endsWith('/cancel')) {
      return Promise.resolve(json(jobJson('cancelled', { rowsTotal: 2, rowsOk: 2 })));
    }
    return Promise.resolve(json({ error: { code: 'not_found' } }, 404));
  };
  return { impl, calls };
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(fetchImpl: FetchLike | null) {
  host = document.createElement('div');
  document.body.append(host);
  const api =
    fetchImpl === null
      ? null
      : new ApiClient({
          origin: 'https://api.example.test',
          orgId: ORG,
          getAccessToken: () => Promise.resolve('tok-synthetic'),
          fetch: fetchImpl,
        });
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <MemoryRouter>
        <ApiContext value={api}>
          <ImportRoute createWorker={inProcessWorker()} />
        </ApiContext>
      </MemoryRouter>,
    );
  });
  return host;
}
const settle = async () => {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
};
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label) ?? null;
async function pick(input: Element | null, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input?.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function click(label: string) {
  const target = button(label);
  expect(target, label).not.toBeNull();
  await act(async () => {
    target?.click();
  });
  await settle();
}

describe('the import route', () => {
  it('shows the heading, the pickers and a disabled Check file before a file is chosen', async () => {
    const el = await mount(null);
    expect(el.querySelector('h2')?.textContent).toBe('Import items');
    expect(el.querySelectorAll('input[type="file"]')).toHaveLength(2);
    expect(button('Check file')?.disabled).toBe(true);
  });

  it('checks a file, imports it, shows a bad row, and finishes', async () => {
    const { impl, calls } = fakeFetch();
    const el = await mount(impl);
    const rows = [mcqRow(1), mcqRow(2, { correct: 'z' }), mcqRow(3)];
    await pick(el.querySelector('#import-file'), asFile(xlsxBytes(rows), 'items.xlsx'));
    expect(button('Check file')?.disabled).toBe(false);
    await click('Check file');
    expect(el.textContent).toContain('Rows in the file: 3');
    expect(el.textContent).toContain('Ready to import: 2');
    expect(el.textContent).toContain('The correct answer must be a letter');
    expect(calls).toEqual([]); // nothing is sent before Start
    await click('Start import');
    expect(el.textContent).toContain('All rows were sent.');
    expect(el.textContent).toContain('Rows accepted: 2');
    expect(el.textContent).toContain('The correct answer must be a letter');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /imports',
      `POST /imports/${JOB}/rows`,
    ]);
    const sent = JSON.parse(calls[1]?.body ?? '{}') as { rows: { rowNo: number }[] };
    expect(sent.rows.map((r) => r.rowNo)).toEqual([2, 4]);
    await click('Finish import');
    expect(el.textContent).toContain('Import finished.');
    expect(el.textContent).toContain('Questions imported: 2');
    expect(button('Cancel import')).toBeNull();
  });

  it('sends the images of the zip once, before the rows', async () => {
    const { impl, calls } = fakeFetch();
    const el = await mount(impl);
    const zip = zipBytes({ 'pic.png': pngBytes(1) });
    await pick(el.querySelector('#import-zip'), asFile(zip, 'pics.zip'));
    await pick(
      el.querySelector('#import-file'),
      asFile(
        xlsxBytes([
          mcqRow(1, { image_file: 'pic.png', image_alt: 'a' }),
          mcqRow(2, { image_file: 'PIC.png', image_alt: 'b' }),
        ]),
        'items.xlsx',
      ),
    );
    await click('Check file');
    expect(el.textContent).toContain('Images found: 1');
    await click('Start import');
    const order = calls.map((c) => c.method + (c.path.includes('/images/') ? ' image' : ''));
    expect(order).toEqual(['POST', 'PUT image', 'POST']);
  });

  it('shows the fixed text for a refused file and creates nothing', async () => {
    const { impl, calls } = fakeFetch();
    const el = await mount(impl);
    await pick(el.querySelector('#import-file'), asFile(xlsxBytes([mcqRow(1)]), 'items.xlsm'));
    await click('Check file');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Files with macros');
    expect(el.textContent).not.toContain('Start import');
    expect(calls).toEqual([]);
  });

  it('with nothing importable, Start import stays disabled', async () => {
    const el = await mount(fakeFetch().impl);
    await pick(
      el.querySelector('#import-file'),
      asFile(xlsxBytes([mcqRow(1, { stem: null })]), 'items.xlsx'),
    );
    await click('Check file');
    expect(button('Start import')?.disabled).toBe(true);
    expect(el.textContent).toContain('A required value is empty.');
  });

  it('cancel after the rows were sent keeps them and says so', async () => {
    const { impl, calls } = fakeFetch();
    const el = await mount(impl);
    await pick(
      el.querySelector('#import-file'),
      asFile(xlsxBytes([mcqRow(1), mcqRow(2)]), 'items.xlsx'),
    );
    await click('Check file');
    await click('Start import');
    await click('Cancel import');
    expect(el.textContent).toContain('Import cancelled. Rows already imported stay in your bank.');
    expect(calls.at(-1)?.path).toBe(`/imports/${JOB}/cancel`);
  });

  it('shows the fixed text when the api refuses the job (second step missing)', async () => {
    const el = await mount((_url, init) =>
      Promise.resolve(
        init.method === 'POST' ? json({ error: { code: 'aal2_required' } }, 403) : json({}),
      ),
    );
    await pick(el.querySelector('#import-file'), asFile(xlsxBytes([mcqRow(1)]), 'items.xlsx'));
    await click('Check file');
    await click('Start import');
    expect(el.textContent).toContain('Two-step sign-in is needed');
    expect(button('Try again')).not.toBeNull();
    expect(button('Cancel import')).not.toBeNull();
  });

  it('a signed-out screen (no api) says so instead of starting', async () => {
    const el = await mount(null);
    await pick(el.querySelector('#import-file'), asFile(xlsxBytes([mcqRow(1)]), 'items.xlsx'));
    await click('Check file');
    await click('Start import');
    expect(el.textContent).toContain('Your session has ended');
  });
});

describe('downloadErrorCsv', () => {
  it('makes a plain-text Blob link named import-errors.csv, clicks it and revokes the URL', () => {
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
        log.push(`create ${blob.type} ${blob.size}`);
        return 'blob:synthetic';
      },
      revokeObjectURL: (url) => log.push(`revoke ${url}`),
      createLink: () => link,
    };
    downloadErrorCsv('a,b\r\n', env);
    expect(log).toEqual([
      'create text/csv;charset=utf-8 5',
      `click blob:synthetic ${ERROR_CSV_NAME}`,
      'revoke blob:synthetic',
    ]);
  });
});
