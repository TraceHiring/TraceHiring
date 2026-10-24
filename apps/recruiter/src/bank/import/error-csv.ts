// The downloadable error list of an import (spec §6.9): made in the browser from the codes. It holds the row, the
// column name and the code, plus the reason in words. It never holds a cell value, so there is nothing to protect
// from spreadsheet formula injection, and every field is still quoted.
import type { RowIssue } from './rows';
import { fieldLabel, rowErrorText } from './texts';

const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;

export const ERROR_CSV_HEADER = 'row,column,code,reason';

export function errorCsv(issues: readonly RowIssue[]): string {
  const lines = issues.map((issue) =>
    [
      String(issue.rowNo),
      quote(fieldLabel(issue.field)),
      quote(issue.code),
      quote(rowErrorText(issue.code)),
    ].join(','),
  );
  return [ERROR_CSV_HEADER, ...lines].join('\r\n') + '\r\n';
}

export const ERROR_CSV_NAME = 'import-errors.csv';
