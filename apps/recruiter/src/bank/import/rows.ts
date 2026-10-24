// Turns the raw cells of a row into an ImportRow, or into row errors: every problem names its row, its column
// (ImportField) and a code (ImportErrorCode), never the cell's value (import_row_errors has no free text; spec §4.3,
// §6.9, AT-M1-11). A row with any problem is not sent, and is never dropped without an error. Rules only the api can
// judge (duplicates in the bank, the skill taxonomy, variant generation) are left to it; whatever it finds comes back
// in the batch answer. Text is carried as plain text; nothing here builds HTML (E10).
import { ImportRow, ParamSpec, type ImportErrorCode } from '@trace/shared/contracts/m1';
import { OPTION_HEADERS, OPTION_LETTERS, type ImportField, type RawRow } from './template';

/** A code only the page makes: the api refused an image for a reason the row codes have no word for. */
export type PageErrorCode = 'image_refused';

export interface RowIssue {
  rowNo: number;
  field: ImportField;
  code: ImportErrorCode | PageErrorCode;
}

/** What the image cell of a row resolved to (the caller looks the name up in the images that came with the file). */
export type ImageResolution =
  { kind: 'none' } | { kind: 'found'; sha256: string } | { kind: 'issue'; code: ImportErrorCode };

export const STEM_MAX = 4000;
export const OPTION_MAX = 500;
export const ALT_MAX = 300;
export const PARAM_SPEC_MAX = 20_000;
const SKILL = /^[a-z][a-z0-9_]{1,40}$/;
const RUBRIC_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** No NUL and no lone UTF-16 surrogate: the text Postgres and the queue can carry (as the contract's `storable`). */
const storable = (s: string): boolean =>
  !s.includes('\u0000') &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

type FieldCheck = 'ok' | 'missing_field' | 'too_long' | 'bad_format';
function textCheck(value: string, max: number): FieldCheck {
  if (value === '') return 'missing_field';
  if (value.length > max) return 'too_long';
  return storable(value) ? 'ok' : 'bad_format';
}

export function buildRow(
  raw: RawRow,
  resolveImage: (raw: RawRow) => ImageResolution,
): { row: ImportRow | null; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const add = (field: ImportField, code: ImportErrorCode): void => {
    if (!issues.some((i) => i.field === field && i.code === code)) {
      issues.push({ rowNo: raw.rowNo, field, code });
    }
  };
  for (const problem of raw.extraProblems) add(problem.field, problem.code);
  const v = raw.values;

  const format = v.format.toLowerCase();
  if (format === '') add('format', 'missing_field');
  else if (format !== 'mcq' && format !== 'written') add('format', 'bad_format');

  if (v.skill === '') add('skill', 'missing_field');
  else if (!SKILL.test(v.skill)) add('skill', 'bad_skill');

  let difficulty = Number.NaN;
  if (v.difficulty === '') add('difficulty', 'missing_field');
  else {
    const n = NUMBER.test(v.difficulty) ? Number(v.difficulty) : Number.NaN;
    const rounded = Math.round(n * 100) / 100;
    if (!Number.isFinite(n) || n < 0 || n > 1 || Math.abs(n - rounded) > 1e-9) {
      add('difficulty', 'bad_difficulty');
    } else {
      difficulty = rounded;
    }
  }

  const stemCheck = textCheck(v.stem, STEM_MAX);
  if (stemCheck !== 'ok') add('stem', stemCheck);

  // Image: a name (xlsx) or an inline picture (docx), and its alt text, come together.
  const hasReference = raw.inlineImage !== null || v.image_file !== '';
  let imageSha256: string | undefined;
  if (hasReference) {
    const resolved = resolveImage(raw);
    if (resolved.kind === 'found') imageSha256 = resolved.sha256;
    else if (resolved.kind === 'issue') add('image_file', resolved.code);
    const alt = textCheck(v.image_alt, ALT_MAX);
    if (alt !== 'ok') add('image_alt', alt);
  } else if (v.image_alt !== '') {
    add('image_file', 'missing_field');
  }

  let options: string[] = [];
  let correct: (typeof OPTION_LETTERS)[number] | undefined;
  let paramSpec: ParamSpec | undefined;
  if (format === 'mcq') {
    const cells = OPTION_HEADERS.map((h) => v[h]);
    let last = -1;
    cells.forEach((cell, i) => {
      if (cell !== '') last = i;
    });
    options = cells.slice(0, last + 1);
    if (last < 0) add('options', 'missing_field');
    else if (last < 1 || options.some((o) => o === '')) add('options', 'bad_options');
    options.forEach((option, i) => {
      const header = OPTION_HEADERS[i];
      if (header === undefined || option === '') return;
      const check = textCheck(option, OPTION_MAX);
      if (check !== 'ok') add(header, check === 'missing_field' ? 'bad_options' : check);
    });

    const letter = v.correct.toLowerCase();
    if (letter === '') add('correct', 'missing_field');
    else {
      const index = OPTION_LETTERS.findIndex((l) => l === letter);
      const found = OPTION_LETTERS[index];
      if (found === undefined || index >= Math.max(options.length, 1)) add('correct', 'bad_key');
      else correct = found;
    }

    if (v.param_spec_json !== '') {
      if (v.param_spec_json.length > PARAM_SPEC_MAX) add('param_spec_json', 'too_long');
      else {
        let json: unknown;
        try {
          json = JSON.parse(v.param_spec_json);
        } catch {
          add('param_spec_json', 'bad_param_spec');
        }
        if (json !== undefined) {
          const spec = ParamSpec.safeParse(json);
          if (spec.success) paramSpec = spec.data;
          else add('param_spec_json', 'bad_param_spec');
        }
      }
    }
  } else if (format === 'written') {
    if (v.rubric_key === '') add('rubric_key', 'missing_field');
    else if (!RUBRIC_KEY.test(v.rubric_key)) add('rubric_key', 'bad_format');
    if (v.param_spec_json !== '') add('param_spec_json', 'bad_param_spec');
  }

  if (issues.length > 0) return { row: null, issues };

  const image = imageSha256 === undefined ? {} : { imageSha256, imageAlt: v.image_alt };
  const candidate =
    format === 'mcq'
      ? {
          rowNo: raw.rowNo,
          format: 'mcq',
          skillKey: v.skill,
          difficulty,
          stem: v.stem,
          options,
          correct,
          ...image,
          ...(paramSpec === undefined ? {} : { paramSpec }),
        }
      : {
          rowNo: raw.rowNo,
          format: 'written',
          skillKey: v.skill,
          difficulty,
          stem: v.stem,
          rubricKey: v.rubric_key,
          ...image,
        };
  const parsed = ImportRow.safeParse(candidate);
  if (!parsed.success) {
    // A rule the contract has that the checks above do not know: still an error, never a drop.
    const field: ImportField = 'row';
    return { row: null, issues: [{ rowNo: raw.rowNo, field, code: 'bad_format' }] };
  }
  return { row: parsed.data, issues: [] };
}
