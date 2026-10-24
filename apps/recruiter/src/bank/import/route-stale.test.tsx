// @vitest-environment happy-dom
// X4 (security review): the file picked while another is still being checked must never be shown or imported as the
// other one. Both pickers are off while a check runs, and a result is kept only for the files still selected.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiClient, type FetchLike } from '../../api/client';
import { ApiContext } from '../../api/runtime';
import { asFile, mcqRow, xlsxBytes } from './fixtures.test-helpers';
import { ImportRoute } from './ImportRoute';
import type { CreateWorker, WorkerLike } from './worker-client';
import { handleWorkerMessage } from './worker-handler';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORG = '11111111-1111-4111-8111-111111111111';

/** A worker that answers only when the test opens the gate; the answer is the real handler's. */
function gatedWorker() {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const create: CreateWorker = () => {
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage(message) {
        void gate.then(async () => {
          const reply = await handleWorkerMessage(message);
          worker.onmessage?.({ data: reply.answer });
        });
      },
      terminate() {},
    };
    return worker;
  };
  return { create, open };
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const calls: string[] = [];
async function mount(create: CreateWorker) {
  calls.length = 0;
  const fetchImpl: FetchLike = (url, init) => {
    calls.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
    return Promise.resolve(new Response('{}', { status: 500 }));
  };
  host = document.createElement('div');
  document.body.append(host);
  const api = new ApiClient({
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
          <ImportRoute createWorker={create} />
        </ApiContext>
      </MemoryRouter>,
    );
  });
  return host;
}
const settle = async () => {
  for (let i = 0; i < 6; i++) {
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

describe('choosing another file while one is being checked (X4)', () => {
  it('turns both pickers off while the check runs', async () => {
    const gated = gatedWorker();
    const el = await mount(gated.create);
    await pick(el.querySelector('#import-file'), asFile(xlsxBytes([mcqRow(1)]), 'first.xlsx'));
    await act(async () => {
      button('Check file')?.click();
    });
    expect(el.textContent).toContain('Reading the file');
    expect(el.querySelector<HTMLInputElement>('#import-file')?.disabled).toBe(true);
    expect(el.querySelector<HTMLInputElement>('#import-zip')?.disabled).toBe(true);
    gated.open();
    await settle();
    expect(el.textContent).toContain('Rows in the file: 1');
  });

  it('shows no result of the first file once the second is selected, and never imports it', async () => {
    const gated = gatedWorker();
    const el = await mount(gated.create);
    await pick(
      el.querySelector('#import-file'),
      asFile(xlsxBytes([mcqRow(1), mcqRow(2), mcqRow(3)]), 'first.xlsx'),
    );
    await act(async () => {
      button('Check file')?.click();
    });
    // A change event still arrives (an older browser, a script, a drag and drop): the page must cope with it.
    await pick(el.querySelector('#import-file'), asFile(xlsxBytes([mcqRow(9)]), 'second.xlsx'));
    gated.open();
    await settle();
    expect(el.textContent).not.toContain('Rows in the file');
    expect(el.textContent).not.toContain('File: first.xlsx');
    expect(el.textContent).not.toContain('File: second.xlsx');
    expect(button('Start import')).toBeNull();
    expect(el.textContent).toContain('Selected: second.xlsx');
    expect(button('Check file')?.disabled).toBe(false);
    expect(calls).toEqual([]);
  });

  it('a result tagged with the file it came from is shown under that file name', async () => {
    const gated = gatedWorker();
    const el = await mount(gated.create);
    await pick(el.querySelector('#import-file'), asFile(xlsxBytes([mcqRow(1)]), 'first.xlsx'));
    await act(async () => {
      button('Check file')?.click();
    });
    gated.open();
    await settle();
    expect(el.textContent).toContain('File: first.xlsx');
    expect(el.textContent).toContain('Rows in the file: 1');
  });
});
