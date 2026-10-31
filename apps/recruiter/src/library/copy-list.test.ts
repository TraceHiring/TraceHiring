// The library copy list (specs/m1-test-authoring.md M1-4, R2-5, LibraryCopyRequest): one to 500 distinct library item
// versions, built one click at a time (no row selection), sent as a single copy request.
import { describe, expect, it } from 'vitest';
import { uid } from '../bank/testing/fixtures.test-helpers';
import {
  COPY_LIMIT,
  addToCopyList,
  inCopyList,
  removeFromCopyList,
  toCopyRequest,
} from './copy-list';

const entry = (n: number) => ({ id: uid(n), stem: `[synthetic] Stem ${String(n)}` });

describe('the copy list', () => {
  it('adds an item once and keeps the order', () => {
    let list = addToCopyList([], entry(1));
    list = addToCopyList(list, entry(2));
    list = addToCopyList(list, entry(1));
    expect(list.map((e) => e.id)).toEqual([uid(1), uid(2)]);
    expect(inCopyList(list, uid(2))).toBe(true);
    expect(inCopyList(list, uid(3))).toBe(false);
  });

  it('stops at 500 items', () => {
    let list: ReturnType<typeof addToCopyList> = [];
    for (let n = 1; n <= COPY_LIMIT + 5; n += 1) list = addToCopyList(list, entry(n));
    expect(list).toHaveLength(COPY_LIMIT);
    expect(COPY_LIMIT).toBe(500);
  });

  it('removes an item', () => {
    const list = removeFromCopyList([entry(1), entry(2)], uid(1));
    expect(list.map((e) => e.id)).toEqual([uid(2)]);
  });

  it('builds the request from the ids, and refuses an empty list', () => {
    expect(toCopyRequest([entry(1), entry(2)])).toEqual({
      libraryItemVersionIds: [uid(1), uid(2)],
    });
    expect(toCopyRequest([])).toBeNull();
  });
});
