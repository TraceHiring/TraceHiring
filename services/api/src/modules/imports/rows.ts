// Server-side re-validation of one import row (spec m1 §4.3, §6.9, M1-9; AT-M1-11): the browser parsed the file, so
// every row is untrusted. Each field is checked on its own and a failure becomes `{field, code}` with the template
// column and a §4.3 code, never the cell value (import_row_errors has no free-text column). A row that passes every
// check is parsed once more by the contract's ImportRow (anything it still refuses is `row`/`bad_format`).
import {
  ImportRow,
  ParamSpec,
  type ImportErrorCode,
  ImportField,
} from '@trace/shared/contracts/m1';
import type { z } from 'zod';

export interface RowIssue {
  field: z.infer<typeof ImportField>;
  code: ImportErrorCode;
}

export interface CheckedRow {
  rowNo: number;
  issues: RowIssue[];
  /** The parsed row when it has no issue. */
  row: ImportRow | null;
}

const KNOWN = new Set([
  'rowNo',
  'format',
  'skillKey',
  'difficulty',
  'stem',
  'options',
  'correct',
  'rubricKey',
  'imageSha256',
  'imageAlt',
  'paramSpec',
]);
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
const OPTION_FIELDS = [
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'option_e',
  'option_f',
] as const;
const SKILL = /^[a-z][a-z0-9_]{1,40}$/;
const RUBRIC_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** Text Postgres and the queue can carry: no U+0000 and no lone surrogate (the contracts' `storable`). */
const storable = (s: string) =>
  !s.includes('\u0000') &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

const absent = (v: unknown) => v === undefined || v === null || v === '';

/** A text cell: missing, too long, unstorable, or fine. */
const textIssue = (v: unknown, max: number): 'missing_field' | 'too_long' | 'bad_format' | null => {
  if (absent(v)) return 'missing_field';
  if (typeof v !== 'string') return 'bad_format';
  if (v.length > max) return 'too_long';
  return storable(v) ? null : 'bad_format';
};

/**
 * The issues of one raw row (`paramOk` is the variant engine's spec check). Format-specific checks run only for a
 * known format.
 */
export const checkRow = (
  raw: Readonly<Record<string, unknown>>,
  rowNo: number,
  paramOk: (spec: unknown) => boolean,
): CheckedRow => {
  const issues: RowIssue[] = [];
  const add = (field: RowIssue['field'], code: ImportErrorCode) => issues.push({ field, code });

  if (Object.keys(raw).some((k) => !KNOWN.has(k))) add('row', 'bad_format');

  const format = raw.format;
  if (absent(format)) add('format', 'missing_field');
  else if (format !== 'mcq' && format !== 'written') add('format', 'bad_format');

  if (absent(raw.skillKey)) add('skill', 'missing_field');
  else if (typeof raw.skillKey !== 'string' || !SKILL.test(raw.skillKey)) add('skill', 'bad_skill');

  const d = raw.difficulty;
  if (d === undefined || d === null) add('difficulty', 'missing_field');
  else if (
    typeof d !== 'number' ||
    !Number.isFinite(d) ||
    d < 0 ||
    d > 1 ||
    Math.abs(d * 100 - Math.round(d * 100)) > 1e-9
  ) {
    add('difficulty', 'bad_difficulty');
  }

  const stem = textIssue(raw.stem, 4000);
  if (stem !== null) add('stem', stem);

  if (format === 'mcq') {
    const options = raw.options;
    let count = 0;
    if (absent(options)) add('options', 'missing_field');
    else if (!Array.isArray(options) || options.length < 2 || options.length > 6) {
      add('options', 'bad_options');
    } else {
      count = options.length;
      options.forEach((o: unknown, i) => {
        const field = OPTION_FIELDS[i] ?? 'options';
        const issue = textIssue(o, 500);
        if (issue === 'too_long') add(field, 'too_long');
        else if (issue !== null) add(field, 'bad_options');
      });
    }
    const correct = raw.correct;
    if (absent(correct)) add('correct', 'missing_field');
    else if (
      typeof correct !== 'string' ||
      !(LETTERS as readonly string[]).includes(correct) ||
      (count > 0 && LETTERS.indexOf(correct as (typeof LETTERS)[number]) >= count)
    ) {
      add('correct', 'bad_key');
    }
    if (raw.paramSpec !== undefined) {
      const spec = ParamSpec.safeParse(raw.paramSpec);
      if (!spec.success || !paramOk(spec.data)) add('param_spec_json', 'bad_param_spec');
    }
  } else if (format === 'written') {
    if (absent(raw.rubricKey)) add('rubric_key', 'missing_field');
    else if (typeof raw.rubricKey !== 'string' || !RUBRIC_KEY.test(raw.rubricKey)) {
      add('rubric_key', 'bad_format');
    }
    if (raw.paramSpec !== undefined) add('param_spec_json', 'bad_param_spec');
    if (raw.options !== undefined || raw.correct !== undefined) add('row', 'bad_format');
  }

  const sha = raw.imageSha256;
  const alt = raw.imageAlt;
  if (sha !== undefined) {
    if (typeof sha !== 'string' || !SHA256.test(sha)) add('image_file', 'bad_image_ref');
    const altIssue = textIssue(alt, 300);
    if (altIssue !== null) add('image_alt', altIssue);
  } else if (alt !== undefined) {
    add('image_file', 'missing_field');
  }

  if (issues.length > 0) return { rowNo, issues: dedupe(issues), row: null };
  const parsed = ImportRow.safeParse(raw);
  if (!parsed.success) return { rowNo, issues: [{ field: 'row', code: 'bad_format' }], row: null };
  return { rowNo, issues: [], row: parsed.data };
};

/** import_row_errors keys a row's errors by field: one code per field (the first found). */
const dedupe = (issues: readonly RowIssue[]): RowIssue[] => {
  const seen = new Set<string>();
  return issues.filter((i) => (seen.has(i.field) ? false : (seen.add(i.field), true)));
};
