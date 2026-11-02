// Candidate text rules shared by the answer editor and the outbox (specs/d1-demo-slice.md §4.4, rev 4g/4h).
// `isStorableText` repeats the contract's check (no U+0000, no lone UTF-16 surrogate), because the candidate bundle
// imports the contracts as types only; text.test.ts keeps the two in step.

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Text Postgres can store in jsonb: no NUL and no lone surrogate. */
export const isStorableText = (s: string): boolean =>
  !s.includes('\u0000') && !LONE_SURROGATE.test(s);

/** The length the edge enforces `maxChars` on: UTF-16 code units. */
export const utf16Length = (s: string): number => s.length;
