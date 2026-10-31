// Reading an invite file (M2-6, M2-7, R2-5, R5-20, E20-E22): the columns, the 18-or-older mapping, the date-of-birth
// refusal, the limits, the .xlsx refusal and the row issues. A refused row carries a reason, never the cell value.
import { InviteRow } from '@trace/shared/contracts/m2';
import { describe, expect, it } from 'vitest';
import { csvOf, csvRow, HEADER } from '../testing/fixtures.test-helpers';
import {
  MAX_FILE_BYTES,
  MAX_ROWS,
  checkInviteBytes,
  refusalBeforeRead,
  type FileCheck,
} from './file';
import { EXCEL_MESSAGE } from './texts';

const bytes = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);
const check = (text: string, name = 'people.csv'): FileCheck => checkInviteBytes(name, bytes(text));
const good = (text: string) => {
  const result = check(text);
  if (!result.ok) throw new Error(`expected a readable file, got ${result.refusal}`);
  return result;
};

describe('the limits', () => {
  it('are 5 MB and 5,000 data rows (M2-7)', () => {
    expect(MAX_FILE_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_ROWS).toBe(5000);
  });

  it('refuses a file over 5 MB before any byte is read', () => {
    expect(refusalBeforeRead('people.csv', MAX_FILE_BYTES + 1)).toBe('too_large');
    expect(refusalBeforeRead('people.csv', MAX_FILE_BYTES)).toBeNull();
    expect(refusalBeforeRead('people.csv', 0)).toBe('empty');
  });

  it('accepts exactly 5,000 data rows and refuses 5,001', () => {
    const rows = (n: number) => csvOf(HEADER, ...Array.from({ length: n }, (_, i) => csvRow(i)));
    const full = good(rows(5000));
    expect(full.rowsInFile).toBe(5000);
    expect(full.rows).toHaveLength(5000);
    expect(check(rows(5001))).toEqual({ ok: false, refusal: 'too_many_rows' });
  });

  it('refuses a header-only file and an empty one', () => {
    expect(check(csvOf(HEADER))).toEqual({ ok: false, refusal: 'empty' });
    expect(check('')).toEqual({ ok: false, refusal: 'empty' });
    expect(check('\r\n\r\n')).toEqual({ ok: false, refusal: 'empty' });
  });
});

describe('a spreadsheet is not a CSV (R5-20)', () => {
  it('refuses .xlsx and .xls by name with exactly the CSV message', () => {
    for (const name of ['people.xlsx', 'People.XLSX', 'people.xls', 'people.xlsm']) {
      expect(refusalBeforeRead(name, 100), name).toBe('excel_file');
      expect(checkInviteBytes(name, bytes(csvOf(HEADER, csvRow(1)))), name).toEqual({
        ok: false,
        refusal: 'excel_file',
      });
    }
    expect(EXCEL_MESSAGE).toBe('Save the sheet as CSV and upload that');
  });

  it('refuses a spreadsheet by its first bytes whatever it is called', () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(checkInviteBytes('people.csv', zip)).toEqual({ ok: false, refusal: 'excel_file' });
    expect(checkInviteBytes('people.csv', ole)).toEqual({ ok: false, refusal: 'excel_file' });
  });

  it('refuses bytes that are not UTF-8 text', () => {
    expect(checkInviteBytes('people.csv', new Uint8Array([0xff, 0xfe, 0x41, 0x00]))).toEqual({
      ok: false,
      refusal: 'not_csv',
    });
  });

  it('refuses a malformed CSV', () => {
    expect(check(`${HEADER}\r\n"unterminated,x\r\n`)).toEqual({ ok: false, refusal: 'not_csv' });
  });
});

describe('the columns', () => {
  it('reads the six columns, whatever the case and order, and a byte order mark', () => {
    const text = `\u{FEFF}Email,FULL_NAME,Language,18_or_older,PHONE,Slot_Starts_At\r\nb@example.test,Ada B,hi,yes,9876543210,2026-11-03 10:00\r\n`;
    const result = good(text);
    expect(result.rows).toEqual([
      {
        rowNo: 1,
        fullName: 'Ada B',
        email: 'b@example.test',
        phone: '9876543210',
        adult18: 'yes',
        slotStartsAt: '2026-11-03T10:00:00+05:30',
        language: 'hi',
      },
    ]);
  });

  it('needs only full_name and email', () => {
    const result = good(csvOf('full_name,email', 'Asha Rao,asha@example.test'));
    expect(result.rows).toEqual([
      { rowNo: 1, fullName: 'Asha Rao', email: 'asha@example.test', adult18: null },
    ]);
  });

  it('refuses a file without full_name or email', () => {
    expect(check(csvOf('full_name,phone', 'Asha Rao,9876543210'))).toEqual({
      ok: false,
      refusal: 'missing_column',
    });
    expect(check(csvOf('email', 'a@example.test'))).toEqual({
      ok: false,
      refusal: 'missing_column',
    });
  });

  it('refuses a column it does not know, with the unknown_column reason, before any row is read', () => {
    expect(check(csvOf(`${HEADER},city`, `${csvRow(1)},Pune`))).toEqual({
      ok: false,
      refusal: 'unknown_column',
    });
    expect(check(csvOf('full_name,email,', 'Asha Rao,a@example.test,'))).toEqual({
      ok: false,
      refusal: 'unknown_column',
    });
  });

  it('refuses a date-of-birth, birth-date or age column (M2-6, E21, rule 9)', () => {
    for (const column of [
      'dob',
      'DOB',
      'date_of_birth',
      'Date of Birth',
      'birth_date',
      'birthday',
      'year_of_birth',
      'age',
    ]) {
      const result = check(csvOf(`${HEADER},${column}`, `${csvRow(1)},2001-01-01`));
      expect(result, column).toEqual({ ok: false, refusal: 'date_of_birth_column' });
    }
  });

  it('puts the date-of-birth refusal before the unknown-column one', () => {
    expect(check(csvOf('full_name,email,city,dob', 'Asha Rao,a@example.test,Pune,2001'))).toEqual({
      ok: false,
      refusal: 'date_of_birth_column',
    });
  });

  it('refuses a repeated column', () => {
    expect(check(csvOf('full_name,email,email', 'Asha Rao,a@example.test,b@example.test'))).toEqual(
      { ok: false, refusal: 'duplicate_column' },
    );
  });

  it('reads a header with spaces or hyphens as the underscore name', () => {
    const result = good(csvOf('Full Name,E-mail,18 or older', 'Asha Rao,a@example.test,yes'));
    expect(result.rows[0]).toMatchObject({ fullName: 'Asha Rao', adult18: 'yes' });
  });
});

describe('the 18_or_older column (R2-5)', () => {
  const adult = (value: string) => {
    const result = good(csvOf('full_name,email,18_or_older', `Asha Rao,a@example.test,${value}`));
    const row = result.rows[0];
    return row === undefined ? result.issues[0]?.reason : row.adult18;
  };

  it('maps yes and blank to yes and null, and no to the minor refusal, in any case', () => {
    expect(adult('yes')).toBe('yes');
    expect(adult('YES')).toBe('yes');
    expect(adult(' Yes ')).toBe('yes');
    expect(adult('no')).toBe('minor');
    expect(adult('No')).toBe('minor');
    expect(adult('')).toBeNull();
  });

  it('gives any other value the row reason bad_adult_value and does not send the row', () => {
    for (const value of ['maybe', 'y', 'true', '18', '1']) {
      const result = good(csvOf('full_name,email,18_or_older', `Asha Rao,a@example.test,${value}`));
      expect(result.rows, value).toEqual([]);
      expect(result.issues, value).toEqual([{ rowNo: 1, reason: 'bad_adult_value' }]);
    }
  });
});

describe('the rows', () => {
  it('numbers data rows from 1 (the header is not a row) and skips blank lines', () => {
    const result = good(csvOf(HEADER, csvRow(1), ',,,,,', '', csvRow(2), '   ,  ,,,,', csvRow(3)));
    expect(result.rowsInFile).toBe(3);
    expect(result.rows.map((row) => row.rowNo)).toEqual([1, 2, 3]);
  });

  it('every row it sends passes the api contract for a row', () => {
    const result = good(csvOf(HEADER, csvRow(1), csvRow(2, 'en'), csvRow(3, 'hi')));
    for (const row of result.rows) expect(InviteRow.safeParse(row).success).toBe(true);
  });

  it('trims cells and drops blank optional ones', () => {
    const result = good(csvOf('full_name,email,phone', '  Asha Rao  , a@example.test ,  '));
    expect(result.rows[0]).toEqual({
      rowNo: 1,
      fullName: 'Asha Rao',
      email: 'a@example.test',
      adult18: null,
    });
  });

  it('accepts names in other scripts (E22)', () => {
    const result = good(
      csvOf('full_name,email', 'आशा राव,a@example.test', 'அருண் குமார்,b@example.test'),
    );
    expect(result.rows).toHaveLength(2);
    expect(result.issues).toEqual([]);
  });

  it('reads times with an offset as they are and times without one as IST', () => {
    const result = good(
      csvOf(
        'full_name,email,slot_starts_at',
        'Asha Rao,a@example.test,2026-11-03T10:00:00+05:30',
        'Asha Rao,b@example.test,2026-11-03T04:30:00Z',
        'Asha Rao,c@example.test,2026-11-03 10:00',
        'Asha Rao,d@example.test,2026-11-03T10:00:30',
      ),
    );
    expect(result.rows.map((row) => row.slotStartsAt)).toEqual([
      '2026-11-03T10:00:00+05:30',
      '2026-11-03T04:30:00Z',
      '2026-11-03T10:00:00+05:30',
      '2026-11-03T10:00:30+05:30',
    ]);
  });

  it('gives an unreadable time the reason bad_slot', () => {
    const result = good(
      csvOf(
        'full_name,email,slot_starts_at',
        'Asha Rao,a@example.test,tomorrow',
        'Asha Rao,b@example.test,2026-02-31 10:00',
        'Asha Rao,c@example.test,2026-11-03 25:00',
        'Asha Rao,d@example.test,03/11/2026 10:00',
      ),
    );
    expect(result.rows).toEqual([]);
    expect(result.issues.map((issue) => issue.reason)).toEqual([
      'bad_slot',
      'bad_slot',
      'bad_slot',
      'bad_slot',
    ]);
  });

  it('gives a language other than en or hi, or blank, a row issue', () => {
    const result = good(csvOf('full_name,email,language', 'Asha Rao,a@example.test,fr'));
    expect(result.issues).toEqual([{ rowNo: 1, reason: 'bad_language' }]);
  });

  it('gives each unusable row one reason, never the value', () => {
    const long = 'A'.repeat(201);
    const result = good(
      csvOf(
        'full_name,email,phone',
        ',a@example.test,',
        `${long},b@example.test,`,
        '1234,c@example.test,',
        'Asha Rao,,',
        'Asha Rao,x,',
        `Asha Rao,d@example.test,${'9'.repeat(33)}`,
        'Asha Rao,e@example.test,9876543210,extra',
        'Asha Rao,f@example.test,',
      ),
    );
    expect(result.rowsInFile).toBe(8);
    expect(result.rows.map((row) => row.rowNo)).toEqual([8]);
    expect(result.issues).toEqual([
      { rowNo: 1, reason: 'missing_name' },
      { rowNo: 2, reason: 'name_too_long' },
      { rowNo: 3, reason: 'missing_name' },
      { rowNo: 4, reason: 'missing_email' },
      { rowNo: 5, reason: 'invalid_email' },
      { rowNo: 6, reason: 'invalid_phone' },
      { rowNo: 7, reason: 'too_many_cells' },
    ]);
    expect(JSON.stringify(result.issues)).not.toContain('example.test');
  });

  it('leaves the api to decide duplicates, phone sharing and slot space', () => {
    const result = good(
      csvOf(
        'full_name,email,phone,18_or_older',
        'Asha Rao,a@example.test,9876543210,yes',
        'Asha Rao,a@example.test,9876543210,yes',
        'Ravi Rao,r@example.test,9876543210,',
      ),
    );
    expect(result.rows).toHaveLength(3);
    expect(result.issues).toEqual([]);
  });

  // Lead decision (rule 9, minimisation): replaces the test that left minors to the api. A row the file marks as under
  // 18 is refused here as `minor` and never becomes a row to send; the api stays the authority for what it receives.
  it('refuses a row whose 18_or_older is no as minor, in any case, and never sends it', () => {
    const result = good(
      csvOf(
        'full_name,email,phone,18_or_older',
        'Asha Rao,a@example.test,9876543210,yes',
        'Ravi Rao,r@example.test,9876543211,no',
        'Mira Rao,m@example.test,, No ',
        'Kiran Rao,k@example.test,,',
      ),
    );
    expect(result.rowsInFile).toBe(4);
    expect(result.rows.map((row) => row.rowNo)).toEqual([1, 4]);
    expect(result.rows.map((row) => row.adult18)).toEqual(['yes', null]);
    expect(result.issues).toEqual([
      { rowNo: 2, reason: 'minor' },
      { rowNo: 3, reason: 'minor' },
    ]);
    expect(JSON.stringify(result)).not.toContain('r@example.test');
    expect(JSON.stringify(result)).not.toContain('"no"');
  });
});
