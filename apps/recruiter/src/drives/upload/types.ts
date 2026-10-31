// The words the invite upload uses for what it cannot use: whole-file refusals and per-row reasons. A row reason is
// either one of the contract's `ROW_REFUSAL_REASONS` (the api's, M2 §3.2) or one of the two this screen decides
// before sending (a language or a cell count the contract has no code for). Never a cell value (AT-M2-32).
import type { RowRefusalReason } from '@trace/shared/contracts/m2';

/** Why a whole file is not used (M2-6, M2-7, R5-20, E21). */
export const FILE_REFUSALS = [
  'excel_file',
  'too_large',
  'empty',
  'not_csv',
  'too_many_rows',
  'unknown_column',
  'date_of_birth_column',
  'missing_column',
  'duplicate_column',
] as const;
export type FileRefusal = (typeof FILE_REFUSALS)[number];

/** Row reasons the browser decides alone, because the contract has no code for them. */
export const LOCAL_ROW_REASONS = ['bad_language', 'too_many_cells'] as const;
export type LocalRowReason = (typeof LOCAL_ROW_REASONS)[number];

export type RowReason = RowRefusalReason | LocalRowReason;

/** A row that is not invited, by its number in the file (the first row after the header is 1) and the reason. */
export interface RowIssue {
  rowNo: number;
  reason: RowReason;
}
