// From a picked file to rows ready to send (spec §6.9): the worker unzips under the R5-48 caps and posts XML strings and
// images; this module parses the XML (DOMParser, on the page), builds the rows and their errors, and hashes the images.
// The file itself never leaves the browser; nothing here talks to the network.
import type { ImportRow } from '@trace/shared/contracts/m1';
import { readDocxRows } from './docx';
import { buildImageIndex, type ImageIndex, type ImageLookup, type PreparedImage } from './images';
import { IMPORT_LIMITS, type ImportLimits } from './limits';
import type { ExtractErrorCode, ExtractResult } from './protocol';
import { buildRow, type ImageResolution, type RowIssue } from './rows';
import type { RawRow } from './template';
import { extractInWorker, type CreateWorker } from './worker-client';
import { readXlsxRows, type SheetFailure } from './xlsx';

/** Why a whole file was refused (nothing is created or sent): the worker's codes plus the page's own. */
export type ParseFailureCode = ExtractErrorCode | SheetFailure;

export interface ParseInput {
  file: File;
  /** An optional images `.zip`, for an xlsx only. */
  imagesZip: File | null;
}
export interface ParseDeps {
  createWorker: CreateWorker;
  limits?: ImportLimits;
}

export interface ParsedImport {
  sourceKind: 'xlsx' | 'docx';
  /** Rows without a problem, in row order, ready for the api. */
  rows: ImportRow[];
  /** Every problem found on the page, one entry per row, column and code. */
  issues: RowIssue[];
  /** The distinct images the sendable rows refer to (content-addressed). */
  images: PreparedImage[];
  /** Rows with content in the file (sendable or not). */
  rowsRead: number;
  imagesInFile: number;
}

export type ParseOutcome =
  { ok: true; parsed: ParsedImport } | { ok: false; code: ParseFailureCode };

const fail = (code: ParseFailureCode): ParseOutcome => ({ ok: false, code });
const MACRO_EXTENSIONS = ['.xlsm', '.xltm', '.xlsb', '.docm', '.dotm'];

const IMAGE_CODE: Record<
  Exclude<ImageLookup['status'], 'found'>,
  'image_missing' | 'image_too_large' | 'image_bad_type' | 'bad_image_ref'
> = {
  missing: 'image_missing',
  too_large: 'image_too_large',
  bad_type: 'image_bad_type',
  ambiguous: 'bad_image_ref',
  invalid: 'bad_image_ref',
};

async function extract(deps: ParseDeps, file: File, kind: 'xlsx' | 'docx' | 'zip') {
  return extractInWorker(deps.createWorker, file, kind);
}

export async function parseImport(input: ParseInput, deps: ParseDeps): Promise<ParseOutcome> {
  const limits = deps.limits ?? IMPORT_LIMITS;
  const lower = input.file.name.toLowerCase();
  if (MACRO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return fail('macro_file');
  const sourceKind = lower.endsWith('.xlsx') ? 'xlsx' : lower.endsWith('.docx') ? 'docx' : null;
  if (sourceKind === null) return fail('bad_extension');

  const main = await extract(deps, input.file, sourceKind);
  if (main.type === 'error') return fail(main.code);
  const sheet =
    sourceKind === 'xlsx'
      ? readXlsxRows(main.xml, limits.rows)
      : readDocxRows(main.xml, limits.rows);
  if (!sheet.ok) return fail(sheet.code);

  let imageSource: ExtractResult | null = main;
  if (sourceKind === 'xlsx') {
    imageSource = null;
    if (input.imagesZip !== null) {
      const zip = await extract(deps, input.imagesZip, 'zip');
      if (zip.type === 'error') return fail(zip.code);
      imageSource = zip;
    }
  }
  const index: ImageIndex = await buildImageIndex(
    imageSource?.images ?? [],
    imageSource?.skippedImages ?? [],
  );

  const used = new Map<string, PreparedImage>();
  const resolve = (raw: RawRow): ImageResolution => {
    let looked: ImageLookup;
    if (raw.inlineImage !== null) {
      if (raw.inlineImage.kind === 'unresolved') return { kind: 'issue', code: 'bad_image_ref' };
      looked = index.lookup(raw.inlineImage.name);
    } else {
      looked = index.lookup(raw.values.image_file);
    }
    if (looked.status !== 'found') return { kind: 'issue', code: IMAGE_CODE[looked.status] };
    used.set(looked.image.sha256, looked.image);
    return { kind: 'found', sha256: looked.image.sha256 };
  };

  const rows: ImportRow[] = [];
  const issues: RowIssue[] = [];
  const kept = new Set<string>();
  for (const raw of sheet.rows) {
    const built = buildRow(raw, resolve);
    issues.push(...built.issues);
    if (built.row !== null) {
      rows.push(built.row);
      if (built.row.imageSha256 !== undefined) kept.add(built.row.imageSha256);
    }
  }
  return {
    ok: true,
    parsed: {
      sourceKind,
      rows,
      issues,
      images: [...used.values()].filter((image) => kept.has(image.sha256)),
      rowsRead: sheet.rows.length,
      imagesInFile: index.count,
    },
  };
}
