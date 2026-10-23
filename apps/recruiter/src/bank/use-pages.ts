// Cursor paging for the M1 lists (R5-54 a: keyset pages of 50, `nextCursor` null on the last page). The first page
// loads whenever `load` changes (a new filter); "Load more" appends the next page. A stale answer is dropped.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResult } from '../api/client';

export interface Page<T> {
  rows: readonly T[];
  nextCursor: string | null;
}

export type PagesState<T> =
  | { kind: 'loading' }
  | { kind: 'error'; code: string }
  | {
      kind: 'ready';
      rows: readonly T[];
      nextCursor: string | null;
      /** True while a further page is on its way. */
      more: boolean;
      /** The failure of the last "Load more", if any (the rows already shown stay). */
      moreError: string | null;
    };

/** `load(cursor)` must be stable (useCallback) apart from the filter it closes over; null means "do not load". */
export function usePages<T>(
  load: ((cursor: string | undefined) => Promise<ApiResult<Page<T>>>) | null,
): { state: PagesState<T>; loadMore(): void; reload(): void } {
  const [state, setState] = useState<PagesState<T>>({ kind: 'loading' });
  const [round, setRound] = useState(0);
  const run = useRef(0);
  const current = useRef(state);
  current.current = state;

  useEffect(() => {
    if (load === null) return;
    run.current += 1;
    const mine = run.current;
    setState({ kind: 'loading' });
    void load(undefined).then((result) => {
      if (mine !== run.current) return;
      setState(
        result.ok
          ? {
              kind: 'ready',
              rows: result.data.rows,
              nextCursor: result.data.nextCursor,
              more: false,
              moreError: null,
            }
          : { kind: 'error', code: result.code },
      );
    });
  }, [load, round]);

  const loadMore = useCallback(() => {
    const now = current.current;
    if (load === null || now.kind !== 'ready' || now.nextCursor === null || now.more) return;
    const mine = run.current;
    const cursor = now.nextCursor;
    setState({ ...now, more: true, moreError: null });
    void load(cursor).then((result) => {
      if (mine !== run.current) return;
      setState((prev) => {
        if (prev.kind !== 'ready') return prev;
        return result.ok
          ? {
              kind: 'ready',
              rows: [...prev.rows, ...result.data.rows],
              nextCursor: result.data.nextCursor,
              more: false,
              moreError: null,
            }
          : { ...prev, more: false, moreError: result.code };
      });
    });
  }, [load]);

  const reload = useCallback(() => {
    setRound((n) => n + 1);
  }, []);
  return { state, loadMore, reload };
}
