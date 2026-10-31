// Reading an invite file in the browser (specs/m2-scheduling-invites.md §6.2, M2-6, M2-7, R2-5, R5-20, E20-E22). The
// file is CSV only: a spreadsheet is refused whole, so are a column the screen does not know, a date-of-birth or age
// column (rule 9: ask the 18-or-older column instead) and a file over 5 MB or 5,000 rows. A row marked under 18 is
// refused here as `minor` and never sent (rule 9, minimisation). What is left becomes rows in
// the api's shape; a row the browser cannot use gets a reason and no value. The api checks everything again.
import { InviteRow } from '@trace/shared/contracts/m2';
import { parseCsv } from '../csv';
import { parseSlotValue } from '../time';
import { MAX_FILE_BYTES, MAX_ROWS } from './limits';
import type { FileRefusal, RowIssue, RowReason } from './types';

export { MAX_FILE_BYTES, MAX_ROWS };

export type FileCheck =
  | { ok: true; rowsInFile: number; rows: InviteRow[]; issues: RowIssue[] }
  | { ok: false; refusal: FileRefusal };

const COLUMNS = [
  'full_name',
  'email',
  'phone',
  '18_or_older',
  'slot_starts_at',
  'language',
] as const;
type Column = (typeof COLUMNS)[number];
const ALIASES: Readonly<Record<string, Column>> = { e_mail: 'email' };

const DOB_LIKE = /^(?:dob|d_o_b|age|age_years|years_old)$|birth/;

const isSpreadsheetName = (name: string): boolean => /\.(?:xlsx|xlsm|xlsb|xls)$/i.test(name.trim());

/** A zip (every .xlsx is one) or an old Excel (OLE) file, by its first bytes. */
function looksLikeSpreadsheet(bytes: Uint8Array): boolean {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  return zip || ole;
}

/** What the name and size alone decide, before any byte is read (File.size). */
export function refusalBeforeRead(name: string, size: number): FileRefusal | null {
  if (isSpreadsheetName(name)) return 'excel_file';
  if (size > MAX_FILE_BYTES) return 'too_large';
  if (size === 0) return 'empty';
  return null;
}

/** Decides a picked file from its name and bytes. The bytes are not kept; the rows are what the caller holds. */
export function checkInviteBytes(name: string, bytes: Uint8Array): FileCheck {
  const early = refusalBeforeRead(name, bytes.byteLength);
  if (early !== null) return { ok: false, refusal: early };
  if (looksLikeSpreadsheet(bytes)) return { ok: false, refusal: 'excel_file' };

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, refusal: 'not_csv' };
  }
  // Blank lines count as records here, so the cap is a generous multiple of the row limit.
  const parsed = parseCsv(text, MAX_ROWS * 2 + 2);
  if (!parsed.ok) {
    return {
      ok: false,
      refusal: parsed.reason === 'too_many_records' ? 'too_many_rows' : 'not_csv',
    };
  }
  return readRecords(parsed.records);
}

const isBlank = (record: readonly string[]): boolean => record.every((cell) => cell.trim() === '');

const normalise = (header: string): string =>
  header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

function readRecords(all: string[][]): FileCheck {
  const first = all.findIndex((record) => !isBlank(record));
  const records = first === -1 ? [] : all.slice(first);
  const header = records[0];
  if (header === undefined) return { ok: false, refusal: 'empty' };

  const names = header.map(normalise);
  if (names.some((name) => DOB_LIKE.test(name)))
    return { ok: false, refusal: 'date_of_birth_column' };
  const columns: Column[] = [];
  for (const name of names) {
    const column = (COLUMNS as readonly string[]).includes(name) ? (name as Column) : ALIASES[name];
    if (column === undefined) return { ok: false, refusal: 'unknown_column' };
    columns.push(column);
  }
  if (new Set(columns).size !== columns.length) return { ok: false, refusal: 'duplicate_column' };
  if (!columns.includes('full_name') || !columns.includes('email')) {
    return { ok: false, refusal: 'missing_column' };
  }

  const data = records.slice(1).filter((record) => !isBlank(record));
  if (data.length === 0) return { ok: false, refusal: 'empty' };
  if (data.length > MAX_ROWS) return { ok: false, refusal: 'too_many_rows' };

  const rows: InviteRow[] = [];
  const issues: RowIssue[] = [];
  data.forEach((cells, index) => {
    const rowNo = index + 1;
    const result = readRow(rowNo, columns, cells);
    if ('reason' in result) issues.push({ rowNo, reason: result.reason });
    else rows.push(result);
  });
  return { ok: true, rowsInFile: data.length, rows, issues };
}

type RowResult = InviteRow | { reason: RowReason };

function readRow(rowNo: number, columns: readonly Column[], cells: readonly string[]): RowResult {
  if (cells.length > columns.length && cells.slice(columns.length).some((c) => c.trim() !== '')) {
    return { reason: 'too_many_cells' };
  }
  const cell = (column: Column): string => {
    const at = columns.indexOf(column);
    return at === -1 ? '' : (cells[at] ?? '').trim();
  };

  const fullName = cell('full_name');
  if (fullName === '') return { reason: 'missing_name' };
  if (fullName.length > 200) return { reason: 'name_too_long' };

  const email = cell('email');
  if (email === '') return { reason: 'missing_email' };
  if (email.length < 3 || email.length > 254) return { reason: 'invalid_email' };

  const phone = cell('phone');
  if (phone.length > 32) return { reason: 'invalid_phone' };

  const adultText = cell('18_or_older').toLowerCase();
  if (adultText !== '' && adultText !== 'yes' && adultText !== 'no') {
    return { reason: 'bad_adult_value' };
  }
  // Rule 9, minimisation (lead decision): a row the file says is under 18 is refused here and never sent, so nothing
  // about that person leaves this browser. The api still refuses any `no` it receives.
  if (adultText === 'no') return { reason: 'minor' };
  const adult18 = adultText === 'yes' ? 'yes' : null;

  const slot = cell('slot_starts_at');
  const slotStartsAt = slot === '' ? undefined : parseSlotValue(slot);
  if (slotStartsAt === null) return { reason: 'bad_slot' };

  const languageText = cell('language').toLowerCase();
  const language = languageText === 'en' || languageText === 'hi' ? languageText : undefined;
  if (languageText !== '' && language === undefined) return { reason: 'bad_language' };

  const row: InviteRow = { rowNo, fullName, email, adult18 };
  if (phone !== '') row.phone = phone;
  if (slotStartsAt !== undefined) row.slotStartsAt = slotStartsAt;
  if (language !== undefined) row.language = language;

  // The api would refuse a whole batch for one row it cannot read, so check the shape here (never the value out).
  const shape = InviteRow.safeParse(row);
  if (shape.success) return row;
  const field = shape.error.issues[0]?.path[0];
  if (field === 'email') return { reason: 'invalid_email' };
  if (field === 'phone') return { reason: 'invalid_phone' };
  if (field === 'slotStartsAt') return { reason: 'bad_slot' };
  return { reason: 'missing_name' };
}
