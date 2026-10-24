// @vitest-environment happy-dom
// AT-M1-11 (spec §6.9, R5-27): every bad row is reachable on the screen, not only in the downloaded list. The errors
// table shows 100 problems a page with Previous and Next, and says which ones it shows.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ERRORS_PER_PAGE, ErrorsTable } from './ImportView';
import type { RowIssue } from './rows';
import { m1Screens } from './m1-screens.test-helpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COUNT = ERRORS_PER_PAGE * 5 + 25; // 525 problems on 6 pages
const issues: RowIssue[] = Array.from({ length: COUNT }, (_, i) => ({
  rowNo: i + 2,
  field: i % 2 === 0 ? ('stem' as const) : ('correct' as const),
  code: i % 2 === 0 ? ('too_long' as const) : ('bad_key' as const),
}));

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(list: readonly RowIssue[]) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<ErrorsTable issues={list} />);
  });
  return host;
}
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label) ?? null;
const press = async (label: string) => {
  const target = button(label);
  expect(target, label).not.toBeNull();
  await act(async () => {
    target?.click();
  });
};
const shownRows = (el: HTMLElement) =>
  [...el.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')?.textContent ?? '');

describe('the errors table pages (S2)', () => {
  it('starts on the first page with Previous off', async () => {
    const el = await mount(issues);
    const rows = shownRows(el);
    expect(rows).toHaveLength(ERRORS_PER_PAGE);
    expect(rows[0]).toBe('2');
    expect(rows.at(-1)).toBe(String(ERRORS_PER_PAGE + 1));
    expect(el.textContent).toContain(`Showing 1–${ERRORS_PER_PAGE} of ${COUNT}`);
    expect(button('Previous')?.disabled).toBe(true);
    expect(button('Next')?.disabled).toBe(false);
  });

  it('reaches the very last problem, and the one at 500 + 25, by pressing Next', async () => {
    const el = await mount(issues);
    const seen = new Set(shownRows(el));
    while (button('Next')?.disabled === false) {
      await press('Next');
      for (const rowNo of shownRows(el)) seen.add(rowNo);
    }
    expect(seen.size).toBe(COUNT);
    expect(seen.has(String(500 + 25 + 1))).toBe(true); // the 525th problem is on row 526
    expect(seen.has(String(COUNT + 1))).toBe(true);
    expect(el.textContent).toContain(`Showing ${ERRORS_PER_PAGE * 5 + 1}–${COUNT} of ${COUNT}`);
    expect(button('Next')?.disabled).toBe(true);
    expect(button('Previous')?.disabled).toBe(false);
  });

  it('goes back with Previous', async () => {
    const el = await mount(issues);
    await press('Next');
    await press('Next');
    expect(shownRows(el)[0]).toBe(String(ERRORS_PER_PAGE * 2 + 2));
    await press('Previous');
    expect(shownRows(el)[0]).toBe(String(ERRORS_PER_PAGE + 2));
  });

  it('shows no paging controls for one page of problems', async () => {
    const el = await mount(issues.slice(0, ERRORS_PER_PAGE));
    expect(shownRows(el)).toHaveLength(ERRORS_PER_PAGE);
    expect(button('Next')).toBeNull();
    expect(button('Previous')).toBeNull();
  });

  it('stays on a page that still exists when the list gets shorter', async () => {
    const el = await mount(issues);
    for (let i = 0; i < 5; i++) await press('Next');
    expect(shownRows(el)).toHaveLength(25);
    await act(async () => {
      root?.render(<ErrorsTable issues={issues.slice(0, ERRORS_PER_PAGE + 10)} />);
    });
    expect(shownRows(el)).toHaveLength(10);
    expect(el.textContent).toContain(`of ${ERRORS_PER_PAGE + 10}`);
  });
});

describe('the screen registry (S8)', () => {
  it('has every state of the import screen, including the paged errors table', () => {
    const names = Object.keys(m1Screens());
    for (const expected of [
      'import choose',
      'import checking',
      'import refused',
      'import checked',
      'import checked docx',
      'import checked many problems',
      'import running',
      'import ready',
      'import ready finish failed',
      'import completing',
      'import cancelling',
      'import stopped',
      'import completed',
      'import cancelled',
      'import failed',
    ]) {
      expect(names, expected).toContain(expected);
    }
  });
});
