/**
 * useLatestPreview — the answer of a server-side preview for a draft the user keeps editing
 * (specs/sas-arrival-total-server-side.md rules 17-21, specs/resource-supplements-total-server-side.md
 * rules 10-13). The screen renders the answer and never estimates in between.
 *
 *   fetcher  — (draft, { signal }) => Promise<answer>; may change identity freely (read through a ref)
 *   draft    — plain JSON of what the answer depends on; only a change of its content triggers a request
 *   enabled  — false while the draft is incomplete: no request, no pending state
 *   scope    — anything that identifies what is being previewed (a stay id, a resource); a new value
 *              restarts the request for the same draft
 *   resetKey — identifies one run of the screen; a new value forgets the last answer
 *   delay    — quiet time before a request (200 ms); the first request after `enabled` leaves at once
 *
 * Returns `{ data, pending, error, fresh, retry }`: `data` is the latest answer (kept while a newer one
 * is pending), `fresh` says it is for the current draft. Only the latest request counts: an older one
 * is aborted, and its late answer ignored.
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';

export default function useLatestPreview({
  fetcher, draft, enabled, scope, resetKey, delay = 200,
}) {
  const signature = useMemo(() => JSON.stringify(draft || {}), [draft]);
  const [answer, setAnswer] = useState({ data: null, signature: null, error: null });
  const [pending, setPending] = useState(false);
  const seqRef = useRef(0);
  const abortRef = useRef(null);
  const timerRef = useRef(null);
  const wasEnabledRef = useRef(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const send = useCallback((sig) => {
    seqRef.current += 1;
    const seq = seqRef.current;
    if (abortRef.current) abortRef.current.abort();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    abortRef.current = controller;
    setPending(true);
    setAnswer((prev) => (prev.error ? { ...prev, error: null } : prev));
    fetcherRef.current(JSON.parse(sig), { signal: controller ? controller.signal : undefined })
      .then((data) => {
        if (seq !== seqRef.current) return;
        setAnswer({ data, signature: sig, error: null });
        setPending(false);
      })
      .catch((error) => {
        if (seq !== seqRef.current || (error && error.name === 'AbortError')) return;
        setAnswer((prev) => ({ ...prev, error }));
        setPending(false);
      });
  }, []);

  useEffect(() => {
    seqRef.current += 1;
    if (abortRef.current) abortRef.current.abort();
    clearTimeout(timerRef.current);
    wasEnabledRef.current = false;
    setAnswer({ data: null, signature: null, error: null });
    setPending(false);
  }, [resetKey]);

  useEffect(() => {
    if (!enabled) {
      seqRef.current += 1;
      if (abortRef.current) abortRef.current.abort();
      clearTimeout(timerRef.current);
      wasEnabledRef.current = false;
      setPending(false);
      return undefined;
    }
    const first = !wasEnabledRef.current;
    wasEnabledRef.current = true;
    setPending(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => send(signature), first ? 0 : delay);
    return () => clearTimeout(timerRef.current);
  }, [enabled, scope, signature, delay, send]);

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const retry = useCallback(() => send(signature), [send, signature]);

  return {
    data: answer.data,
    pending,
    error: answer.error,
    fresh: !pending && !answer.error && answer.signature === signature && answer.data != null,
    retry,
  };
}
