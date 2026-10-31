// AT-M2-32 (specs/m2-scheduling-invites.md §12, R5-20, R5-34): a refused row is rendered with its row number and its
// reason in plain words, for every reason the contract lists, and never with the cell value; a spreadsheet is
// refused with the CSV message. Rendering is server-side (no DOM needed). Synthetic data only.
import { ROW_REFUSAL_REASONS } from '@trace/shared/contracts/m2';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { csvOf } from '../testing/fixtures.test-helpers';
import { checkInviteBytes } from './file';
import type { RunState } from './run';
import { EXCEL_MESSAGE, FILE_REFUSAL_TEXT, ROW_REASON_TEXT, rowReasonText } from './texts';
import { FILE_REFUSALS, LOCAL_ROW_REASONS, type RowIssue, type RowReason } from './types';
import {
  HeldTable,
  REFUSED_PER_PAGE,
  RefusedTable,
  UploadView,
  type Screen,
  type UploadHandlers,
} from './UploadView';

const noop = () => undefined;
const handlers: UploadHandlers = {
  onFile: noop,
  onStart: noop,
  onChooseAnother: noop,
  onCancel: noop,
  onRetry: noop,
  onMarkDifferent: noop,
  onFinish: noop,
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
      <UploadView driveId="d1" screen={screen} handlers={handlers} />
    </MemoryRouter>,
  );
const rowsOf = (html: string) =>
  [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => text(m[1] ?? ''));

const ALL_REASONS: readonly RowReason[] = [...ROW_REFUSAL_REASONS, ...LOCAL_ROW_REASONS];

describe('the refused-rows table (AT-M2-32)', () => {
  const issues: RowIssue[] = ALL_REASONS.map((reason, i) => ({ rowNo: 3 + i * 7, reason }));

  it('renders every reason, local and api, in plain words next to its row number', () => {
    const html = renderToString(<RefusedTable issues={issues} />);
    const rows = rowsOf(html);
    expect(rows[0]).toContain('Row');
    expect(rows[0]).toContain('Reason');
    expect(rows.slice(1)).toHaveLength(issues.length);
    issues.forEach((issue, i) => {
      const row = rows[i + 1] ?? '';
      expect(row, issue.reason).toContain(String(issue.rowNo));
      expect(row, issue.reason).toContain(ROW_REASON_TEXT[issue.reason]);
    });
  });

  it('has a plain-words reason for every reason in the contract', () => {
    expect(ROW_REFUSAL_REASONS.length).toBeGreaterThanOrEqual(16);
    for (const reason of ALL_REASONS) {
      const words = ROW_REASON_TEXT[reason];
      expect(words, reason).toMatch(/^[A-Z].{12,}\.$/);
      expect(rowReasonText(reason)).toBe(words);
      // Plain words: the code itself is never the text.
      expect(words, reason).not.toContain(reason);
    }
  });

  it('shows no code, no field value and no markup from the file, whatever the file said', () => {
    const canary = ['canary.one@example.test', 'Canary Name', '+919999000000', '<b>x</b>'];
    const file = csvOf(
      'full_name,email,phone,18_or_older,slot_starts_at,language',
      `Canary Name,canary.one@example.test,+919999000000,maybe,,en`,
      `Canary Name,canary.one@example.test,${'9'.repeat(40)},yes,,en`,
      `Canary Name,not-an-email-<b>x</b>,,yes,not-a-time,xx`,
    );
    const checked = checkInviteBytes('people.csv', new TextEncoder().encode(file));
    if (!checked.ok) throw new Error('the synthetic file should be readable');
    expect(checked.issues.length).toBe(3);
    const html = renderToString(<RefusedTable issues={checked.issues} />);
    for (const value of canary) expect(html).not.toContain(value);
    expect(html).not.toContain('bad_adult_value');
    expect(text(html)).toContain(ROW_REASON_TEXT.bad_adult_value);
  });

  it('shows one page of rows and says which, when there are very many', () => {
    const many: RowIssue[] = Array.from({ length: REFUSED_PER_PAGE * 3 + 5 }, (_, i) => ({
      rowNo: i + 1,
      reason: 'invalid_email' as const,
    }));
    const html = renderToString(<RefusedTable issues={many} />);
    expect(REFUSED_PER_PAGE).toBe(100);
    expect(rowsOf(html)).toHaveLength(REFUSED_PER_PAGE + 1);
    expect(text(html)).toContain(
      `Showing rows 1 to ${String(REFUSED_PER_PAGE)} of ${String(many.length)}`,
    );
    expect(renderToString(<RefusedTable issues={[]} />)).toBe('');
  });

  // Lead decision (M2-5, R5-59): one button per held row. Replaces the test that expected a single button.
  it('lists held rows with their numbers, each with its own button that frees exactly that row', () => {
    const html = renderToString(<HeldTable rowNos={[4, 9]} busy={false} onMarkDifferent={noop} />);
    const rows = rowsOf(html);
    expect(rows.slice(1)).toHaveLength(2);
    expect(rows[1]).toContain('4');
    expect(rows[2]).toContain('9');
    expect(text(html)).toContain(ROW_REASON_TEXT.phone_shared);
    const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    expect(buttons.map((m) => text(m[2] ?? '').trim())).toEqual([
      'Mark as different people',
      'Mark as different people',
    ]);
    expect(buttons.map((m) => /aria-label="([^"]*)"/.exec(m[1] ?? '')?.[1])).toEqual([
      'Mark as different people, row 4',
      'Mark as different people, row 9',
    ]);
    // Each button sits in its own row.
    const tableRows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1] ?? '');
    expect(tableRows[1]).toContain('row 4');
    expect(tableRows[2]).toContain('row 9');
  });

  it('disables every row’s button while a re-send is in flight', () => {
    const html = renderToString(<HeldTable rowNos={[4, 9]} busy={true} onMarkDifferent={noop} />);
    const buttons = [...html.matchAll(/<button([^>]*)>/g)].map((m) => m[1] ?? '');
    expect(buttons).toHaveLength(2);
    for (const attrs of buttons) expect(attrs).toContain('disabled=""');
  });
});

describe('a file that is refused as a whole (M2-6, M2-7, R5-20, E21)', () => {
  const choose = (refusal: Extract<Screen, { kind: 'choose' }>['refusal']) =>
    render({ kind: 'choose', refusal, reading: false });

  it('says "Save the sheet as CSV and upload that" for a spreadsheet', () => {
    const html = choose('excel_file');
    expect(text(html)).toContain('Save the sheet as CSV and upload that');
    expect(EXCEL_MESSAGE).toBe('Save the sheet as CSV and upload that');
    expect(html).toContain('role="alert"');
  });

  it('says "Use the 18-or-older column" for a date-of-birth column', () => {
    expect(text(choose('date_of_birth_column'))).toContain('Use the 18-or-older column');
  });

  it('has plain words for every file refusal, and shows only the one that applies', () => {
    for (const refusal of FILE_REFUSALS) {
      const html = choose(refusal);
      expect(text(html), refusal).toContain(FILE_REFUSAL_TEXT[refusal]);
      expect(FILE_REFUSAL_TEXT[refusal], refusal).not.toContain(refusal);
      for (const other of FILE_REFUSALS) {
        if (other !== refusal && FILE_REFUSAL_TEXT[other] !== FILE_REFUSAL_TEXT[refusal]) {
          expect(text(html), `${refusal} vs ${other}`).not.toContain(FILE_REFUSAL_TEXT[other]);
        }
      }
    }
  });

  it('lists the expected columns as text, with no template to fetch', () => {
    const html = choose(null);
    for (const column of [
      'full_name',
      'email',
      'phone',
      '18_or_older',
      'slot_starts_at',
      'language',
    ]) {
      expect(text(html)).toContain(column);
    }
    expect(html).toContain('accept="text/csv"');
    expect(html).not.toMatch(/download/i);
  });
});

describe('the results of a run', () => {
  const run = (patch: Partial<RunState>): RunState => ({
    phase: 'ready',
    uploadId: '33333333-3333-4333-8333-333333333333',
    rowsInFile: 6,
    rowsSent: 6,
    rowsToSend: 6,
    invited: 3,
    refused: [
      { rowNo: 2, reason: 'minor' },
      { rowNo: 5, reason: 'already_invited' },
    ],
    held: [4],
    reuploadWarning: false,
    failure: null,
    upload: null,
    busy: false,
    ...patch,
  });

  it('shows the invited count, the rows in the file, and each refused row with its reason', () => {
    const html = render({ kind: 'run', run: run({}) });
    const body = text(html);
    expect(body).toMatch(/Invited\s*:?\s*3/);
    expect(body).toMatch(/Rows in file\s*:?\s*6/);
    expect(body).not.toMatch(/\btotal\b/i);
    const refused = rowsOf(html).filter((row) => row.includes(ROW_REASON_TEXT.minor));
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain('2');
    expect(body).toContain(ROW_REASON_TEXT.already_invited);
    expect(body).toContain('Mark as different people');
  });

  it('offers no way to mark rows once the upload is finished and none were held', () => {
    const html = render({ kind: 'run', run: run({ phase: 'completed', held: [] }) });
    expect(text(html)).not.toContain('Mark as different people');
  });
});
