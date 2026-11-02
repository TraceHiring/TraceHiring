// One-shot loading of an api resource for a screen, with a reload. `load` must be stable (useCallback).
import { useCallback, useEffect, useState } from 'react';
import type { ApiResult } from '../api/client';

export type Resource<T> =
  { kind: 'loading' } | { kind: 'ready'; data: T } | { kind: 'error'; code: string };

export function useResource<T>(
  load: (() => Promise<ApiResult<T>>) | null,
): [Resource<T>, () => void] {
  const [state, setState] = useState<Resource<T>>({ kind: 'loading' });
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (load === null) return;
    let live = true;
    void load().then((result) => {
      if (!live) return;
      setState(
        result.ok ? { kind: 'ready', data: result.data } : { kind: 'error', code: result.code },
      );
    });
    return () => {
      live = false;
    };
  }, [load, round]);
  const reload = useCallback(() => {
    setRound((n) => n + 1);
  }, []);
  return [state, reload];
}
