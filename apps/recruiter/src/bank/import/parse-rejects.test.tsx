// @vitest-environment happy-dom
// S6: whatever goes wrong inside the check, the route ends on worker_failed's fixed text, never on "Reading the file…".
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../api/runtime';
import { asFile, inProcessWorker, mcqRow, xlsxBytes } from './fixtures.test-helpers';

const stub = vi.hoisted(() => ({ rejectWith: new Error('synthetic failure') }));
vi.mock('./parse', () => ({
  parseImport: () => Promise.reject(stub.rejectWith),
}));
const { ImportRoute } = await import('./ImportRoute');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('the route when the check itself rejects', () => {
  it('shows the worker_failed text and lets the user check again', async () => {
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
    const input = host.querySelector('#import-file');
    Object.defineProperty(input, 'files', {
      value: [asFile(xlsxBytes([mcqRow(1)]), 'items.xlsx')],
      configurable: true,
    });
    await act(async () => {
      input?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      [...document.querySelectorAll('button')].find((b) => b.textContent === 'Check file')?.click();
    });
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });
    }
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'The file could not be read in this browser.',
    );
    expect(host.textContent).not.toContain('Reading the file');
    const again = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Check file',
    );
    expect(again?.disabled).toBe(false);
  });
});
