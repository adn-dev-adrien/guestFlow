/**
 * useMoneyCommit — the money-dialog contract in ONE place (specs/plugins-phase-1-sdk.md rule 58, loop t26; owner decision of 2026-11-19
 * « corriger les problèmes à la source »). Every dialog that previews money and commits it — the counter sale, the outside visit's arrival,
 * the hourly booking, the SAS recaps, « Nouvelle note », the platform penalty, the payout split, the credit link, the fiche's payment forms —
 * takes from here what used to be decided screen by screen, and the generative harness (`src/__tests__/moneyDialogs.invariants.*`) checks
 * the result after every gesture of thousands of generated runs:
 *
 *   useMoneyCommit({ previews, dueCents, tenders, splitting, questions }) → { ready, tendersNow, live() }
 *       The commit is enabled only on a FRESH answer of every preview for the draft on screen (`fresh`: not pending, not failed, for this
 *       draft), with the tender lines' report answering the due on screen (`tendersForDue`) and allowing the commit, and every required
 *       question answered (`questions`: booleans). `live()` is asked again by the commit handler: a click that lands before the report of
 *       the lines just typed sends nothing (I2).
 *   useTenderDraft() → { report, onChange, initialDraft, reset }
 *       The lines as the operator left them, kept by the screen, so a tender block that unmounts (a failed recompute, a step back, a due back
 *       from 0) comes back exactly as typed (`initialDraft`); only the operator closing « Plusieurs moyens » or choosing another payment mode
 *       starts them afresh (`reset`) (I3).
 *   isRetryable(error) / PreviewFailure
 *       A failure says why and offers a way out (I5): « Réessayer » when retrying can help (no answer, 5xx, 408, 429); a refusal (another
 *       4xx) is an answer — the same draft would be refused again — so its reason shows alone; editing the draft is the way out.
 *   MoneyActions
 *       The actions row of a money dialog is a `FocusKeeper` region: the commit goes busy (disabled) on its click, and the focus stays in the
 *       row instead of falling to the page or to the dialog's root (I4).
 *
 * Nothing here computes money: the amounts are the server's answers (CLAUDE.md §6.0).
 */
import React, { useCallback, useState } from 'react';
import { Alert, DialogActions } from '@mui/material';
import ErrorAlert from '../components/ErrorAlert';
import FocusKeeper from '../components/FocusKeeper';
import { tendersForDue } from '../components/TenderLines';

const RETRY_STATUSES = [408, 429];

/** Whether asking the same draft again can help: no answer at all, a server failure, a timeout or a rate limit. */
export function isRetryable(error) {
  if (!error) return false;
  const status = Number(error.status);
  return !status || status >= 500 || RETRY_STATUSES.includes(status);
}

/**
 * PreviewFailure — the failure of a money preview: its reason, with « Réessayer » only when retrying can help.
 * Props: error (the request's error, or null), onRetry, fallback (the words when the error carries none), sx.
 */
export function PreviewFailure({ error, onRetry, fallback = 'Montant indisponible.', sx }) {
  if (!error) return null;
  const message = error.message || fallback;
  if (isRetryable(error)) return <ErrorAlert message={message} onRetry={onRetry} sx={sx} />;
  return <Alert severity="error" sx={sx}>{message}</Alert>;
}

/** The actions row of a money dialog, as a focus region (any `DialogActions` prop). */
export function MoneyActions({ children, ...rest }) {
  return <FocusKeeper component={DialogActions} {...rest}>{children}</FocusKeeper>;
}

/** The tender lines' report and the draft they come back with when their block is drawn again. */
export function useTenderDraft() {
  const [report, setReport] = useState(null);
  const reset = useCallback(() => setReport(null), []);
  return {
    report, onChange: setReport, initialDraft: report ? report.draft : null, reset,
  };
}

/**
 * Whether the commit can be sent now. `previews`: the screen's previews (`{ fresh }`, from `useLatestPreview` or a hook built on it);
 * `dueCents`: the due on screen (null while unknown); `tenders`: the lines' latest report; `splitting`: the lines are the payment;
 * `questions`: every other requirement of the commit, as booleans.
 */
export default function useMoneyCommit({
  previews = [], dueCents = null, tenders = null, splitting = false, questions = [],
}) {
  const tendersNow = splitting && dueCents != null ? tendersForDue(tenders, dueCents) : null;
  const ready = previews.every((p) => Boolean(p && p.fresh))
    && questions.every(Boolean)
    && (!splitting || Boolean(tendersNow && tendersNow.canSubmit));
  const live = () => !splitting || Boolean(tendersNow && tendersNow.live());
  return { ready, tendersNow, live };
}
