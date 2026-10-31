// One page at a time over a keyset cursor (specs/m2-scheduling-invites.md R5-31, R5-44): "Next page" asks for the
// cursor the last page returned, "Previous page" asks for the page before again, so the rows shown are always fresh.
// A stale answer is dropped. `patch` changes the rows on screen without a request (a row action's new row).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResult } from '../api/client';

export interface Page<T> {
  rows: readonly T[];
  nextCursor: string | null;
}

export type PagerState<T> =
  { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ready'; rows: readonly T[] };

export interface Pager<T> {
  state: PagerState<T>;
  hasPrevious: boolean;
  hasNext: boolean;
  next(): void;
  previous(): void;
  /** Back to the first page, loaded again. */
  reset(): void;
  patch(update: (rows: readonly T[]) => readonly T[]): void;
}

/** `load(cursor)` must be stable (useCallback); null means "do not load yet". */
export function usePager<T>(
  load: ((cursor: string | undefined) => Promise<ApiResult<Page<T>>>) | null,
): Pager<T> {
  const [stack, setStack] = useState<readonly (string | undefined)[]>([undefined]);
  const [round, setRound] = useState(0);
  const [state, setState] = useState<PagerState<T>>({ kind: 'loading' });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const cursor = stack[stack.length - 1];
  const current = useRef(0);

  useEffect(() => {
    if (load === null) return;
    current.current += 1;
    const mine = current.current;
    setState({ kind: 'loading' });
    void load(cursor).then((result) => {
      if (mine !== current.current) return;
      if (result.ok) {
        setState({ kind: 'ready', rows: result.data.rows });
        setNextCursor(result.data.nextCursor);
      } else {
        setState({ kind: 'error', code: result.code });
        setNextCursor(null);
      }
    });
  }, [load, cursor, round]);

  const next = useCallback(() => {
    if (nextCursor !== null) setStack((s) => [...s, nextCursor]);
  }, [nextCursor]);
  const previous = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);
  const reset = useCallback(() => {
    setStack([undefined]);
    setRound((n) => n + 1);
  }, []);
  const patch = useCallback((update: (rows: readonly T[]) => readonly T[]) => {
    setState((s) => (s.kind === 'ready' ? { kind: 'ready', rows: update(s.rows) } : s));
  }, []);

  return {
    state,
    hasPrevious: stack.length > 1,
    hasNext: state.kind === 'ready' && nextCursor !== null,
    next,
    previous,
    reset,
    patch,
  };
}
