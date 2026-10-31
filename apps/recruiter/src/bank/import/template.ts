// The Trace import templates, version trace-items-v1 (spec §6.9). Nothing here reads a file.
import type { ImportErrorCode, ImportField as ImportFieldSchema } from '@trace/shared/contracts/m1';

/** The template column a row error points at (contracts-m1 ImportField). */
export type ImportField = (typeof ImportFieldSchema.options)[number];

export const TEMPLATE_VERSION = 'trace-items-v1' as const;
export const SHEET_NAME = 'Items';

/** The fixed header row of `trace-items-v1.xlsx`. All fifteen names must be present; their order is free. */
export const ITEM_HEADERS = [
  'format',
  'skill',
  'difficulty',
  'stem',
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'option_e',
  'option_f',
  'correct',
  'rubric_key',
  'image_file',
  'image_alt',
  'param_spec_json',
] as const;
export type ItemHeader = (typeof ITEM_HEADERS)[number];

export const OPTION_HEADERS = [
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'option_e',
  'option_f',
] as const;
export const OPTION_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

/** The `Trace Meta` keys of the docx template: the xlsx columns that are not stem, options or correct. */
export const DOCX_META_KEYS = [
  'format',
  'skill',
  'difficulty',
  'rubric_key',
  'image_alt',
  'param_spec_json',
] as const satisfies readonly ItemHeader[];

/** A value of one row as read from either template, before any rule is applied. Blank cells are ''. */
export interface RawRow {
  rowNo: number;
  values: Record<ItemHeader, string>;
  /** Docx only: a Trace Meta key that is not in DOCX_META_KEYS, or a second image in one item. */
  extraProblems: { field: ImportField; code: ImportErrorCode }[];
  /** Docx only: the image placed inline in the item (the xlsx names a file in `image_file` instead). */
  inlineImage: InlineImage | null;
}

export type InlineImage = { kind: 'part'; name: string } | { kind: 'unresolved' };

export const emptyValues = (): Record<ItemHeader, string> => ({
  format: '',
  skill: '',
  difficulty: '',
  stem: '',
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  option_e: '',
  option_f: '',
  correct: '',
  rubric_key: '',
  image_file: '',
  image_alt: '',
  param_spec_json: '',
});

/**
 * The one example row of both template files: synthetic, and plainly an example (spec §6.9). The fields not named here
 * are blank. Reading either template file gives back exactly this row, with no problem.
 */
export const TEMPLATE_EXAMPLE: Readonly<Record<ItemHeader, string>> = {
  ...emptyValues(),
  format: 'mcq',
  skill: 'quant',
  difficulty: '0.5',
  stem: 'Example question (replace or delete this row): which option is listed second?',
  option_a: 'First option',
  option_b: 'Second option',
  option_c: 'Third option',
  correct: 'b',
};
