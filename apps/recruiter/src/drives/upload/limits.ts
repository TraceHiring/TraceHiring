// Invite upload caps (specs/m2-scheduling-invites.md M2-7, R5-20). The api checks the same numbers again for every
// row, so skipping one in a modified browser gains nothing.

/** The picked file, checked against `File.size` before any byte is read. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Data rows per file (the header is not a row). */
export const MAX_ROWS = 5000;
/** Rows per request. */
export const BATCH_SIZE = 200;
/** Requests in flight at once. */
export const CONCURRENCY = 2;
