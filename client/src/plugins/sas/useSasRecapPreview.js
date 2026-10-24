/**
 * useSasRecapPreview — a SAS recap as the server prices it (specs/sas-arrival-total-server-side.md
 * rules 17-21, specs/sas-departure-recap-server-side.md rules 16-17): one hook for both ends.
 *
 *   request       — the preview call of the end being run (`api.previewArrivalSas` / `api.previewDepartureSas`)
 *   reservationId — the stay
 *   draft         — the draft (`buildArrivalDraft` / `buildDepartureDraft`), the very body the commit will send
 *   enabled       — true on the pages that show money (the recap, the pages that sell or bill)
 *   resetKey      — anything that identifies one run of the wizard; a new value forgets the last answer
 *   delay         — quiet time before a request (200 ms); the first request of a page leaves at once
 *
 * Returns `{ recap, pending, error, fresh, retry }`: `recap` is the latest answer (kept while a newer
 * one is pending, so the screen never shows a client estimate), `fresh` says that answer is for the
 * current draft. Only the latest request counts: an older one is aborted, and its late answer ignored.
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';

export default function useSasRecapPreview({
  request, reservationId, draft, enabled, resetKey, delay = 200,
}) {
  const signature = useMemo(() => JSON.stringify(draft || {}), [draft]);
  const [answer, setAnswer] = useState({ recap: null, signature: null, error: null });
  const [pending, setPending] = useState(false);
  const seqRef = useRef(0);
  const abortRef = useRef(null);
  const timerRef = useRef(null);
  const wasEnabledRef = useRef(false);
  const requestRef = useRef(request);
  requestRef.current = request;

  const send = useCallback((sig) => {
    seqRef.current += 1;
    const seq = seqRef.current;
    if (abortRef.current) abortRef.current.abort();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    abortRef.current = controller;
    setPending(true);
    requestRef.current(reservationId, JSON.parse(sig), { signal: controller ? controller.signal : undefined })
      .then((recap) => {
        if (seq !== seqRef.current) return;
        setAnswer({ recap, signature: sig, error: null });
        setPending(false);
      })
      .catch((error) => {
        if (seq !== seqRef.current || (error && error.name === 'AbortError')) return;
        setAnswer((prev) => ({ ...prev, error }));
        setPending(false);
      });
  }, [reservationId]);

  useEffect(() => {
    seqRef.current += 1;
    if (abortRef.current) abortRef.current.abort();
    clearTimeout(timerRef.current);
    wasEnabledRef.current = false;
    setAnswer({ recap: null, signature: null, error: null });
    setPending(false);
  }, [resetKey]);

  useEffect(() => {
    if (!enabled || !reservationId) {
      wasEnabledRef.current = false;
      return undefined;
    }
    const first = !wasEnabledRef.current;
    wasEnabledRef.current = true;
    setPending(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => send(signature), first ? 0 : delay);
    return () => clearTimeout(timerRef.current);
  }, [enabled, reservationId, signature, delay, send]);

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const retry = useCallback(() => send(signature), [send, signature]);

  return {
    recap: answer.recap,
    pending,
    error: answer.error,
    fresh: !pending && !answer.error && answer.signature === signature && answer.recap != null,
    retry,
  };
}
