/**
 * useLatestRequest — keeps a screen from showing the answer of a request that has been superseded.
 *
 *   const begin = useLatestRequest();
 *   const load = async () => { const current = begin(); const data = await api.read(); if (current()) setData(data); };
 *
 * `begin()` starts a request and returns `current()`, true only while no newer `begin()` (or unmount)
 * happened. Every `await` result, error and `finally` of the request is guarded by it.
 */
import { useCallback, useEffect, useRef } from 'react';

export default function useLatestRequest() {
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current += 1; }, []);
  return useCallback(() => {
    sequence.current += 1;
    const mine = sequence.current;
    return () => mine === sequence.current;
  }, []);
}
