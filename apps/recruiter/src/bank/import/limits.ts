// Import caps (spec §6.9, R2-19, E9, E11, R5-48; docs/adr/ADR-033). Every number here is checked in the worker before
// and during inflate, and again by the api for every row and image, so skipping one in a modified browser gains nothing.
const MIB = 1_048_576;

/** One image is at most 1 MiB = 1,048,576 bytes (R2-19; the client's putImage refuses more). The lead replaces this
 * with a shared contract constant at merge. */
export const IMPORT_IMAGE_MAX_BYTES = 1_048_576;

export interface ImportLimits {
  /** The picked `.xlsx` (the sheet file), checked against `File.size` before any byte is read. */
  sheetFileBytes: number;
  /** The picked images `.zip` or `.docx`, checked against `File.size` before any byte is read. */
  archiveFileBytes: number;
  /** Uncompressed bytes of one archive in total, summed over every entry (declared first, then counted while inflating). */
  uncompressedBytes: number;
  /** One XML part, uncompressed (decided here: the spec gives no per-part number). */
  xmlPartBytes: number;
  /** Every XML part of one archive together, uncompressed. */
  xmlTotalBytes: number;
  imageBytes: number;
  /** Images per import (R2-19). */
  images: number;
  /** Data rows (docx items) per import (§4.3). */
  rows: number;
  /** Zip entries per archive, so the directory itself stays small (decided here). */
  entries: number;
}

export const IMPORT_LIMITS: ImportLimits = {
  sheetFileBytes: 10 * MIB,
  archiveFileBytes: 100 * MIB,
  uncompressedBytes: 100 * MIB,
  xmlPartBytes: 20 * MIB,
  xmlTotalBytes: 40 * MIB,
  imageBytes: IMPORT_IMAGE_MAX_BYTES,
  images: 2000,
  rows: 2000,
  entries: 10_000,
};

/** A batch holds at most 100 rows (ImportRowsRequest), sent three at a time; images go six at a time (§6.9). */
export const ROW_BATCH_SIZE = 100;
export const ROW_CONCURRENCY = 3;
export const IMAGE_CONCURRENCY = 6;

/** The compressed bytes handed to the inflater at a time. One push of n bytes can expand to about 1032 n, so a small
 * chunk bounds the memory of a single step before the running counter looks at it. */
export const FEED_CHUNK_BYTES = 16 * 1024;
