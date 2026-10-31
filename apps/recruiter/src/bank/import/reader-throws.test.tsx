// @vitest-environment happy-dom
// S6 + X2: a page-side reader that throws (a malformed part the DOM cannot walk) is one constant code, never an
// unhandled rejection and never a screen stuck on "Reading the file…".
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../api/runtime';
import {
  asFile,
  docxBytes,
  inProcessWorker,
  mcqDocxItem,
  mcqRow,
  xlsxBytes,
} from './fixtures.test-helpers';

const boom = vi.hoisted(() => ({ xlsx: false, docx: false, images: false }));
vi.mock('./xlsx', async (importOriginal) => {
  const real = await importOriginal<typeof import('./xlsx')>();
  return {
    ...real,
    readXlsxRows: (...args: Parameters<typeof real.readXlsxRows>) => {
      if (boom.xlsx) throw new Error('synthetic reader failure');
      return real.readXlsxRows(...args);
    },
  };
});
vi.mock('./docx', async (importOriginal) => {
  const real = await importOriginal<typeof import('./docx')>();
  return {
    ...real,
    readDocxRows: (...args: Parameters<typeof real.readDocxRows>) => {
      if (boom.docx) throw new Error('synthetic reader failure');
      return real.readDocxRows(...args);
    },
  };
});
vi.mock('./images', async (importOriginal) => {
  const real = await importOriginal<typeof import('./images')>();
  return {
    ...real,
    buildImageIndex: (...args: Parameters<typeof real.buildImageIndex>) => {
      if (boom.images) return Promise.reject(new Error('synthetic image failure'));
      return real.buildImageIndex(...args);
    },
  };
});

const { parseImport } = await import('./parse');
const { ImportRoute } = await import('./ImportRoute');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const deps = { createWorker: inProcessWorker() };

beforeEach(() => {
  boom.xlsx = false;
  boom.docx = false;
  boom.images = false;
});

describe('parseImport when a reader throws', () => {
  it('turns a throwing xlsx reader into bad_xml', async () => {
    boom.xlsx = true;
    expect(
      await parseImport(
        { file: asFile(xlsxBytes([mcqRow(1)]), 'items.xlsx'), imagesZip: null },
        deps,
      ),
    ).toEqual({ ok: false, code: 'bad_xml' });
  });

  it('turns a throwing docx reader into bad_xml', async () => {
    boom.docx = true;
    expect(
      await parseImport(
        { file: asFile(docxBytes([mcqDocxItem(1)]), 'items.docx'), imagesZip: null },
        deps,
      ),
    ).toEqual({ ok: false, code: 'bad_xml' });
  });

  it('turns a failing image index into bad_xml', async () => {
    boom.images = true;
    expect(
      await parseImport(
        { file: asFile(xlsxBytes([mcqRow(1)]), 'items.xlsx'), imagesZip: null },
        deps,
      ),
    ).toEqual({ ok: false, code: 'bad_xml' });
  });

  it('still parses when nothing throws', async () => {
    const outcome = await parseImport(
      { file: asFile(xlsxBytes([mcqRow(1)]), 'items.xlsx'), imagesZip: null },
      deps,
    );
    expect(outcome.ok).toBe(true);
  });
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('the route when a reader throws', () => {
  it('shows an alert instead of staying on "Reading the file…"', async () => {
    boom.xlsx = true;
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
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('is not valid');
    expect(host.textContent).not.toContain('Reading the file');
  });
});
