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
 * Returns `{ data, last, pending, error, failed, fresh, retry }`: `data` is the latest answer (kept while a
 * newer one is pending), `fresh` says it is for the current draft. Only the latest request counts: an older
 * one is aborted, and its late answer ignored.
 *
 * A request that FAILS makes the answer unknown (loop t23 S23-1, specs/plugins-phase-1-sdk.md rule 54 reading of
 * 2026-11-18): `data` turns null and `failed` stays true — through a « Réessayer » still pending — until a new
 * answer arrives, so no screen keeps drawing the figures of an older draft, or a money control set from them,
 * next to its error. `last` keeps the latest answer for a screen that draws its layout from it and shows every
 * amount « — » and every money control disabled while `failed` (the SAS recap pages, the booking dialog's price layout). `error`
 * stays too until a new answer — through a pending « Réessayer » — so the alert and its button never vanish under the focus while
 * the retry is asked (loop t23 verifier).
 *
 * The failure belongs to the draft (and scope) it was asked for, and only `retry` keeps it (loop t24 UI24-2): once the draft is
 * edited — or asked again on its own, enabled again or for a new scope — `error` and `failed` are gone, the draft is in its ordinary
 * pending state (`data` the latest answer, not `fresh`), and only its own request can fail it. A preview whose draft is built from
 * another answer (the invoice question of a typed payment) therefore never shows the failure of a payment the screen no longer holds.
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';

const EMPTY = {
  data: null, signature: null, error: null, failed: false, failedFor: null,
};
const failureOf = (answer, signature, scope) => Boolean(answer.failedFor)
  && answer.failedFor.signature === signature && Object.is(answer.failedFor.scope, scope);

export default function useLatestPreview({
  fetcher, draft, enabled, scope, resetKey, delay = 200,
}) {
  const signature = useMemo(() => JSON.stringify(draft || {}), [draft]);
  const [answer, setAnswer] = useState(EMPTY);
  const [pending, setPending] = useState(false);
  const seqRef = useRef(0);
  const abortRef = useRef(null);
  const timerRef = useRef(null);
  const wasEnabledRef = useRef(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const send = useCallback((sig) => {
    seqRef.current += 1;
    const seq = seqRef.current;
    if (abortRef.current) abortRef.current.abort();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    abortRef.current = controller;
    const asked = scopeRef.current;
    setPending(true);
    fetcherRef.current(JSON.parse(sig), { signal: controller ? controller.signal : undefined })
      .then((data) => {
        if (seq !== seqRef.current) return;
        setAnswer({ ...EMPTY, data, signature: sig });
        setPending(false);
      })
      .catch((error) => {
        if (seq !== seqRef.current || (error && error.name === 'AbortError')) return;
        setAnswer((prev) => ({
          ...prev, error, failed: true, failedFor: { signature: sig, scope: asked },
        }));
        setPending(false);
      });
  }, []);

  useEffect(() => {
    seqRef.current += 1;
    if (abortRef.current) abortRef.current.abort();
    clearTimeout(timerRef.current);
    wasEnabledRef.current = false;
    setAnswer(EMPTY);
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
    // A request the screen asks on its own (an edited draft, a new scope, the draft enabled again) is not « Réessayer »: it ends the
    // previous failure. Only `retry` keeps it, through its pending request.
    setAnswer((prev) => (prev.failed ? { ...prev, error: null, failed: false, failedFor: null } : prev));
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => send(signature), first ? 0 : delay);
    return () => clearTimeout(timerRef.current);
  }, [enabled, scope, signature, delay, send]);

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const retry = useCallback(() => send(signature), [send, signature]);

  const failed = answer.failed && failureOf(answer, signature, scope);
  return {
    data: failed ? null : answer.data,
    last: answer.data,
    pending,
    error: failed ? answer.error : null,
    failed,
    fresh: !pending && !answer.failed && answer.signature === signature && answer.data != null,
    retry,
  };
}
