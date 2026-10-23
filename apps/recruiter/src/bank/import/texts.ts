// Fixed user-facing text for the import screen. Every reason is plain language for one code; a cell value, a server
// message, a file name inside the archive or a URL is never part of any text (spec §6.9, import_row_errors has no free
// text). The words stay clear of the product's never-build and decision lists (m1-guards.test.tsx).
import type { ImportErrorCode } from '@trace/shared/contracts/m1';
import { errorText } from '../../common/messages';
import type { PageErrorCode } from './rows';
import type { ImportField } from './template';

export const ROW_ERROR_TEXT: Readonly<Record<ImportErrorCode, string>> = {
  missing_field: 'A required value is empty.',
  bad_format: 'The value is not in the expected format.',
  bad_skill: 'The skill is not valid. Use a skill key from the template.',
  bad_difficulty: 'Difficulty must be a number from 0 to 1 in steps of 0.01.',
  bad_options: 'A multiple-choice question needs 2 to 6 options with no empty option between them.',
  bad_key: 'The correct answer must be a letter from a to f that names one of the options.',
  too_long: 'The value is longer than allowed.',
  bad_image_ref: 'The image reference is not valid, or it matches more than one file.',
  image_missing: 'The image file was not found in the file or the images zip.',
  image_too_large: 'The image is larger than 1 MB.',
  image_bad_type: 'The image must be a PNG, JPEG or WebP picture.',
  duplicate_in_file: 'This question appears more than once in the file.',
  duplicate_in_bank: 'This question is already in your bank.',
  bad_param_spec: 'The parameter spec is not valid.',
  variant_generation_failed:
    'The parameter spec could not produce enough different variants of this question.',
  row_limit: 'More than 2,000 rows: the limit for one import is 2,000.',
};

/** Codes only this page makes (rows.ts PageErrorCode); they are in the error list like any other code. */
export const PAGE_ERROR_TEXT: Readonly<Record<PageErrorCode, string>> = {
  image_refused: 'The server refused this image.',
};

export const FIELD_LABEL: Readonly<Record<ImportField, string>> = {
  row: 'Whole row',
  format: 'Format',
  skill: 'Skill',
  difficulty: 'Difficulty',
  stem: 'Question text',
  options: 'Options',
  option_a: 'Option A',
  option_b: 'Option B',
  option_c: 'Option C',
  option_d: 'Option D',
  option_e: 'Option E',
  option_f: 'Option F',
  correct: 'Correct answer',
  rubric_key: 'Rubric key',
  image_file: 'Image file',
  image_alt: 'Image description',
  param_spec_json: 'Parameter spec',
};

export const rowErrorText = (code: string): string =>
  (ROW_ERROR_TEXT as Record<string, string | undefined>)[code] ??
  (PAGE_ERROR_TEXT as Record<string, string | undefined>)[code] ??
  'The row has a problem.';
export const fieldLabel = (field: string): string =>
  (FIELD_LABEL as Record<string, string | undefined>)[field] ?? field;

/** Why a whole file was refused, or why a run stopped: the worker's codes, the page's, the api's and the job's. */
const FAILURE_TEXT: Readonly<Record<string, string>> = {
  // The file itself (nothing was created or sent)
  bad_extension:
    'Choose a .xlsx or .docx file made from the Trace template. An images file must be a .zip.',
  macro_file:
    'Files with macros (.xlsm, .docm, .xlsb) are not accepted. Save the file as .xlsx or .docx without macros.',
  file_too_large:
    'The file is too large. A spreadsheet can be up to 10 MB; a Word file or an images zip up to 100 MB.',
  archive_too_large:
    'The file is much larger once unpacked than it is allowed to be, so it was stopped.',
  too_many_entries: 'The file holds too many parts to read.',
  too_many_images: 'The file has more than 2,000 images.',
  bad_archive: 'The file could not be read. Check that it is a complete .xlsx, .docx or .zip file.',
  worker_failed: 'The file could not be read in this browser. Try again.',
  bad_template:
    'This is not the Trace items template (trace-items-v1): its Items sheet, columns or item styles are missing.',
  bad_xml: 'A part of the file is not valid, so it could not be read.',
  no_rows: 'The file has no rows to import.',
  row_limit: ROW_ERROR_TEXT.row_limit,
  // The job (import_jobs.error_code)
  image_limit: 'More than 2,000 images: the limit for one import is 2,000.',
  timeout: 'The import took too long and was stopped. Rows already imported stay.',
  internal: 'The import failed on our side. Try again. Rows already imported stay.',
  // The api and the network
  network: 'The network failed. Your progress is kept; try again.',
  unavailable: 'The service is not available right now. Try again in a moment.',
  invalid_response: 'The service sent an answer this page could not read. Try again.',
  forbidden: 'You do not have access to import items.',
  nothing_to_import: 'No row can be imported. Fix the problems listed and choose the file again.',
};

/** Fixed text for a failure code; an unknown code gets the generic message, never the server's. */
export function failureText(code: string): string {
  return FAILURE_TEXT[code] ?? errorText(code);
}

/** Every code that has its own text here (tests iterate it). */
export const FAILURE_CODES: readonly string[] = Object.keys(FAILURE_TEXT);
