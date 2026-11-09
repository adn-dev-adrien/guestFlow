/**
 * One read of the API for a screen: `{ data, error, loading, reload }`, read again when `deps` change (the
 * language, a slug). The previous data stays on screen while the next read runs, so a language switch never
 * blanks the page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function useLoad(read, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(async () => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await read();
      if (mine === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (mine === seq.current) setState((s) => ({ data: s.data, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}
