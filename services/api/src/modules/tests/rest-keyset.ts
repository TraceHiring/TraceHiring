// Keyset pages for the M1 org lists (spec m1 R5-54 a: bank, library, invite, pool and template lists are `PageCursor`
// keyset pages of 50, `{createdAt, id}`, never a carrier of scope or filters; R5-53 d). The cursor's `createdAt` is the
// exact text PostgREST returned for the row's `created_at` (timestamptz, microseconds): it is never parsed into a JS
// `Date`, which would drop the microseconds and skip or repeat rows. PostgREST compares the quoted text as timestamptz.
import { decodePageCursor, encodePageCursor, PageCursor } from '@trace/shared/contracts/m1';
import { orgFail, type Query } from './org-context.js';

/** One page of every M1 list (the contracts' PAGE_SIZE). */
export const PAGE_SIZE = 50;

export type PageDirection = 'asc' | 'desc';

/**
 * The PostgREST query parts of one page after `cursor`: ordered by `(created_at, id)` in `dir`, one row past the page
 * (so `pageOf` knows whether another page exists). The cursor is re-parsed first, so a value that could change the
 * filter's grammar never reaches it (400 `bad_request`).
 */
export const keysetQuery = (cursor: PageCursor | null, dir: PageDirection): Query => {
  const base = { order: `created_at.${dir},id.${dir}`, limit: String(PAGE_SIZE + 1) };
  if (cursor === null) return base;
  const parsed = PageCursor.safeParse(cursor);
  if (!parsed.success) return orgFail('bad_request');
  const { createdAt, id } = parsed.data;
  const op = dir === 'asc' ? 'gt' : 'lt';
  return {
    or: `(created_at.${op}."${createdAt}",and(created_at.eq."${createdAt}",id.${op}.${id}))`,
    ...base,
  };
};

export interface Page<R> {
  rows: R[];
  nextCursor: string | null;
}

/**
 * Cuts a `keysetQuery` read to one page; the next cursor is the last kept row's `created_at` text and id, or null on
 * the last page. A row whose keyset does not parse is 503 `unavailable` (never echoed).
 */
export const pageOf = <R extends { id: string; created_at: string }>(
  rows: readonly R[],
): Page<R> => {
  const kept = rows.slice(0, PAGE_SIZE);
  if (rows.length <= PAGE_SIZE) return { rows: kept, nextCursor: null };
  const last = kept[kept.length - 1];
  const keyset = PageCursor.safeParse({ createdAt: last?.created_at, id: last?.id });
  if (!keyset.success) return orgFail('unavailable');
  return { rows: kept, nextCursor: encodePageCursor(keyset.data) };
};

/** The keyset of a `cursor` query value; absent is the first page, anything decodePageCursor refuses is 400. */
export const cursorOf = (text: string | undefined): PageCursor | null => {
  if (text === undefined) return null;
  return decodePageCursor(text) ?? orgFail('bad_request');
};
