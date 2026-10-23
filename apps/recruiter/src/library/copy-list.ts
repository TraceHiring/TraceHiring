// The library copy list (specs/m1-test-authoring.md M1-4, R2-5; LibraryCopyRequest): one to 500 distinct library item
// versions, built one click at a time so there is no row selection, sent as one copy request.
import type { LibraryCopyRequest } from '@trace/shared/contracts/m1';

export const COPY_LIMIT = 500;

export interface CopyEntry {
  /** The library item version id. */
  id: string;
  /** What the list shows for it. */
  stem: string;
}

export const inCopyList = (list: readonly CopyEntry[], id: string): boolean =>
  list.some((e) => e.id === id);

/** Adds an entry once, in order, up to `COPY_LIMIT`. */
export function addToCopyList(list: readonly CopyEntry[], entry: CopyEntry): CopyEntry[] {
  if (inCopyList(list, entry.id) || list.length >= COPY_LIMIT) return [...list];
  return [...list, entry];
}

export const removeFromCopyList = (list: readonly CopyEntry[], id: string): CopyEntry[] =>
  list.filter((e) => e.id !== id);

/** The request for the list, or null when it is empty. */
export function toCopyRequest(list: readonly CopyEntry[]): LibraryCopyRequest | null {
  return list.length === 0 ? null : { libraryItemVersionIds: list.map((e) => e.id) };
}
