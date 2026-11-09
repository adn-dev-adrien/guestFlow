/** `useLoad(fn, deps)` → `{ data, error, loading, reload, setData }`: one read, its error, a retry. */
import { useCallback, useEffect, useRef, useState } from 'react';

export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useRef(0);
  const load = useCallback(() => {
    const id = ++run.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    return Promise.resolve().then(fn).then(
      (data) => { if (id === run.current) setState({ data, error: null, loading: false }); return data; },
      (error) => { if (id === run.current) setState((s) => ({ ...s, error, loading: false })); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  const setData = useCallback((next) => setState((s) => ({ ...s, data: typeof next === 'function' ? next(s.data) : next })), []);
  return { ...state, reload: load, setData };
}
