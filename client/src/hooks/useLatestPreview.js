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
 * A draft that can no longer be asked (`enabled` false: emptied, invalid, closed) ends the failure too, and `retry` asks nothing while
 * disabled (loop t24 S24-2). And while disabled `data` is null unless the latest answer is for the draft on screen (loop t25 UI25-1): a
 * screen never draws an older draft's figures as current. `last` still keeps it, for a screen that deliberately keeps the latest answer
 * while its draft waits (the invoice question of a typed payment).
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';

// `stale`: the answer kept is from before a failure that was since put aside (an edit, the draft disabled): drawn, never current.
const EMPTY = {
  data: null, signature: null, error: null, failed: false, failedFor: null, stale: false,
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
  // What is on its way and what the latest accepted answer is for (loop t26, rule 58): a draft that comes back to one of them is not asked
  // again, so `fresh` never reads true for one render on an answer the hook is about to ask over (the invoice question and the booking's
  // save read it).
  const inflightRef = useRef(null);
  const settledRef = useRef(null);
  // A request scheduled for the draft on screen (its quiet time running): until it leaves and answers, the screen is pending, whatever an
  // older request answers meanwhile (loop t26, booking seed 944: a failed « Réessayer » ended the pending state of a draft about to be asked).
  const scheduledRef = useRef(false);

  const send = useCallback((sig) => {
    seqRef.current += 1;
    const seq = seqRef.current;
    if (abortRef.current) abortRef.current.abort();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    abortRef.current = controller;
    const asked = scopeRef.current;
    scheduledRef.current = false;
    inflightRef.current = { signature: sig, scope: asked };
    setPending(true);
    fetcherRef.current(JSON.parse(sig), { signal: controller ? controller.signal : undefined })
      .then((data) => {
        if (seq !== seqRef.current) return;
        inflightRef.current = null;
        settledRef.current = { signature: sig, scope: asked };
        setAnswer({ ...EMPTY, data, signature: sig });
        setPending(scheduledRef.current);
      })
      .catch((error) => {
        if (seq !== seqRef.current || (error && error.name === 'AbortError')) return;
        inflightRef.current = null;
        settledRef.current = null;
        setAnswer((prev) => ({
          ...prev, error, failed: true, failedFor: { signature: sig, scope: asked },
        }));
        setPending(scheduledRef.current);
      });
  }, []);

  useEffect(() => {
    seqRef.current += 1;
    if (abortRef.current) abortRef.current.abort();
    clearTimeout(timerRef.current);
    wasEnabledRef.current = false;
    inflightRef.current = null;
    settledRef.current = null;
    setAnswer(EMPTY);
    setPending(false);
  }, [resetKey]);

  useEffect(() => {
    if (!enabled) {
      seqRef.current += 1;
      if (abortRef.current) abortRef.current.abort();
      clearTimeout(timerRef.current);
      wasEnabledRef.current = false;
      inflightRef.current = null;
      setPending(false);
      // Nothing is asked any more (the draft emptied, made invalid, the screen closed): a failure about it has nothing left to retry
      // (loop t24 S24-2).
      setAnswer((prev) => (prev.failed ? {
        ...prev, error: null, failed: false, failedFor: null, stale: true,
      } : prev));
      return undefined;
    }
    const first = !wasEnabledRef.current;
    wasEnabledRef.current = true;
    // Loop t26 (rule 58) — the draft came back to what is already on its way: that request answers it, nothing new is asked. It came back
    // to the draft of the latest accepted answer: that answer is current again — what was asked since is dropped, and the screen is not
    // pending. Either way `fresh` follows the request the screen actually waits for, never a render ahead of it.
    const isCurrent = (ref) => Boolean(ref) && ref.signature === signature && Object.is(ref.scope, scope);
    // The same holds when the draft is asked again after a while it could not be (`first`: a payment unreadable for a keystroke, the
    // invoice question waiting for its price): enabled again on the very draft it answered, the hook asks nothing (loop t26 verifier).
    if (!first && isCurrent(inflightRef.current)) {
      clearTimeout(timerRef.current);
      setPending(true);
      return () => clearTimeout(timerRef.current);
    }
    if (isCurrent(settledRef.current)) {
      seqRef.current += 1;
      if (abortRef.current) abortRef.current.abort();
      inflightRef.current = null;
      clearTimeout(timerRef.current);
      setPending(false);
      setAnswer((prev) => (prev.failed ? {
        ...prev, error: null, failed: false, failedFor: null, stale: true,
      } : prev));
      return () => clearTimeout(timerRef.current);
    }
    setPending(true);
    // A request the screen asks on its own (an edited draft, a new scope, the draft enabled again) is not « Réessayer »: it ends the
    // previous failure. Only `retry` keeps it, through its pending request.
    setAnswer((prev) => (prev.failed ? {
        ...prev, error: null, failed: false, failedFor: null, stale: true,
      } : prev));
    clearTimeout(timerRef.current);
    scheduledRef.current = true;
    timerRef.current = setTimeout(() => send(signature), first ? 0 : delay);
    return () => { clearTimeout(timerRef.current); scheduledRef.current = false; };
  }, [enabled, scope, signature, delay, send]);

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const retry = useCallback(() => { if (enabled) send(signature); }, [send, signature, enabled]);

  const failed = answer.failed && failureOf(answer, signature, scope);
  // A draft that cannot be asked holds no answer of its own: the latest one belongs to an OLDER draft, and nothing will replace it, so it is
  // not `data` (loop t25 UI25-1) — the screen shows its placeholders, as after a failure. Gated on `enabled`, not on `pending`: an edited
  // draft that is still asked keeps the latest answer, dimmed, for the frame before its request leaves.
  const foreign = !enabled && answer.signature !== signature;
  return {
    data: failed || foreign ? null : answer.data,
    last: answer.data,
    pending,
    error: failed ? answer.error : null,
    failed,
    fresh: !pending && !answer.failed && !answer.stale && answer.signature === signature && answer.data != null,
    // Loop t26 (rule 58) — the identities behind `fresh`: the draft the latest answer was for, and the draft on screen. A commit gate
    // (`useMoneyCommit`) compares them itself, so no boolean of an earlier request can stand for the draft on screen.
    // After a failure the answer kept is from before it: it names no draft until a new answer (the draft back to it is asked afresh).
    answerKey: answer.data != null && !answer.failed && !answer.stale ? answer.signature : null,
    draftKey: signature,
    retry,
  };
}
