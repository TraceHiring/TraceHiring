// Fixed plain-words text for the invite upload (specs/m2-scheduling-invites.md §6.2, M2-6, M2-7, R5-20, AT-M2-32).
// Every refusal reason has words here; none of them repeats a cell value or the code itself, and none uses a word the
// D1/M1 guard lists ban. The api's own text is never shown.
import { ROW_REFUSAL_REASONS } from '@trace/shared/contracts/m2';
import { driveErrorText } from '../messages';
import type { FileRefusal, RowReason } from './types';
import { LOCAL_ROW_REASONS } from './types';

/** Shown for a spreadsheet, exactly (R5-20). */
export const EXCEL_MESSAGE = 'Save the sheet as CSV and upload that';
/** Shown for a date-of-birth or age column, exactly (M2-6, E21). */
export const DATE_OF_BIRTH_MESSAGE = 'Use the 18-or-older column';

export const FILE_REFUSAL_TEXT: Readonly<Record<FileRefusal, string>> = {
  excel_file: EXCEL_MESSAGE,
  too_large: 'The file is larger than 5 MB.',
  empty: 'The file has no rows to invite.',
  not_csv: 'The file could not be read as CSV text.',
  too_many_rows: 'The file has more than 5,000 rows. Split it into smaller files.',
  unknown_column:
    'The file has a column this screen does not know. Use only the columns listed above.',
  date_of_birth_column: DATE_OF_BIRTH_MESSAGE,
  missing_column: 'The first row of the file must have the columns full_name and email.',
  duplicate_column: 'A column name appears twice in the first row of the file.',
};

export const ROW_REASON_TEXT: Readonly<Record<RowReason, string>> = {
  missing_name: 'The name is missing, or it has characters a name cannot contain.',
  missing_contact: 'There is no email address or phone number.',
  invalid_email: 'The email address is not valid.',
  invalid_phone:
    'The phone number is not valid. Use 10 digits, or add the country code with a plus sign.',
  duplicate_email_in_file: 'This email address is already used by an earlier row in the file.',
  duplicate_phone_in_file: 'This phone number is already used by an earlier row in the file.',
  already_invited: 'This email address is already invited to this drive.',
  phone_shared:
    'This phone number belongs to someone already invited to this drive, so the row is held.',
  minor: 'The file says this person is under 18, so they were not invited and nothing was stored.',
  bad_adult_value: 'The 18_or_older value must be yes, no or blank.',
  bad_slot: 'The slot time is not a valid time, or it is not one of this drive’s open slots.',
  slot_full: 'The slot asked for is full.',
  name_too_long: 'The name is longer than 200 characters.',
  row_limit: 'The file has more rows than one upload can hold.',
  unknown_column: 'The file has a column this screen does not know.',
  missing_email: 'The email address is missing. Every row needs one.',
  bad_language: 'The language must be en or hi, or blank.',
  too_many_cells:
    'The row has more cells than the first row. Put quotes around any value that has a comma.',
};

export const rowReasonText = (reason: RowReason): string => ROW_REASON_TEXT[reason];

// A compile-time and run-time check that every reason has words (the tests also walk the lists).
const ALL: readonly RowReason[] = [...ROW_REFUSAL_REASONS, ...LOCAL_ROW_REASONS];
export const ROW_REASONS: readonly RowReason[] = ALL;

/** Why a run stopped or could not start, in words. Falls back to the drive screens' fixed error text. */
export const failureText = (code: string): string => driveErrorText(code);

/** What each column of the file is, in order (shown as text; the template is not a download, R5-59). */
export const COLUMN_HELP: readonly { name: string; need: string; help: string }[] = [
  { name: 'full_name', need: 'Required', help: 'The candidate’s name, up to 200 characters.' },
  { name: 'email', need: 'Required', help: 'Where the invitation goes. One address per row.' },
  { name: 'phone', need: 'Optional', help: '10 digits, or a plus sign and the country code.' },
  {
    name: '18_or_older',
    need: 'Optional',
    help: 'yes or no. Leave it blank if you do not know; the candidate answers it too.',
  },
  {
    name: 'slot_starts_at',
    need: 'Optional',
    help: 'For scheduled drives: the start of one of the slots, such as 2026-11-03 10:00 (IST unless the value has an offset such as +05:30). Blank means the earliest slot with space.',
  },
  { name: 'language', need: 'Optional', help: 'en or hi. Blank means en.' },
];
