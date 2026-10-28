/**
 * useMonthDataCache — per-month data for a month-by-month view (specs/calendar-property-parity.md rule 15).
 *
 * A month is fetched once, the first time its block asks for it (`ensure`), and kept for as long as the
 * `scopeKey` (the logement shown) stays the same. Changing the scope drops every entry and aborts what is
 * in flight; a response that comes back for a scope or a month that is no longer shown is ignored, so a
 * slow answer can never overwrite a newer one.
 *
 * @param {string|number} scopeKey what the data is about (a logement id, 'all'…)
 * @param {(year:number, month:number, signal:AbortSignal) => Promise<any>} loadMonth month is 0-based
 * @returns {{
 *   scopeKey: string|number,
 *   entries: Record<string, {status:'loading'|'ready'|'error', data?:any, error?:Error}>, // keyed `${year}-${month}`
 *   ensure: (year:number, month:number) => void,
 *   retry: (year:number, month:number) => void,
 * }}
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

const storeKey = (scope, year, month) => `${scope}|${year}-${month}`;

export default function useMonthDataCache(scopeKey, loadMonth) {
  const store = useRef(new Map());
  const controllers = useRef(new Map());
  const [version, bump] = useReducer((n) => n + 1, 0);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const loadRef = useRef(loadMonth);
  loadRef.current = loadMonth;

  const start = useCallback((year, month) => {
    const scope = String(scopeRef.current);
    for (const key of [...store.current.keys()]) {
      if (!key.startsWith(`${scope}|`)) {
        const stale = controllers.current.get(key);
        if (stale) stale.abort();
        controllers.current.delete(key);
        store.current.delete(key);
      }
    }
    const key = storeKey(scope, year, month);
    const controller = new AbortController();
    controllers.current.set(key, controller);
    store.current.set(key, { status: 'loading' });
    bump();
    const settle = (entry) => {
      if (controller.signal.aborted || controllers.current.get(key) !== controller) return;
      controllers.current.delete(key);
      store.current.set(key, entry);
      bump();
    };
    let pending;
    try { pending = Promise.resolve(loadRef.current(year, month, controller.signal)); } catch (error) { pending = Promise.reject(error); }
    pending.then((data) => settle({ status: 'ready', data }), (error) => settle({ status: 'error', error }));
  }, []);

  const ensure = useCallback((year, month) => {
    if (!store.current.has(storeKey(String(scopeRef.current), year, month))) start(year, month);
  }, [start]);

  const retry = useCallback((year, month) => {
    const key = storeKey(String(scopeRef.current), year, month);
    const running = controllers.current.get(key);
    if (running) running.abort();
    controllers.current.delete(key);
    store.current.delete(key);
    start(year, month);
  }, [start]);

  useEffect(() => () => {
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    store.current.clear();
  }, []);

  const entries = useMemo(() => {
    const prefix = `${scopeKey}|`;
    const out = {};
    store.current.forEach((entry, key) => { if (key.startsWith(prefix)) out[key.slice(prefix.length)] = entry; });
    return out;
    // `version` is the change signal of the mutable store.
  }, [version, scopeKey]);

  return { scopeKey, entries, ensure, retry };
}
