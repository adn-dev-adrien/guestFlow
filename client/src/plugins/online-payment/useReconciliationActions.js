// The writes of the reconciliation, shared by the fiche's card and the page: each one calls the server,
// words a refusal through the toast, and tells the caller to reload (specs/qonto-bank-reconciliation.md
// rules 26, 34, 39).
import { useCallback, useState } from 'react';
import { api, useToast } from '../sdk';

export default function useReconciliationActions({ onChanged }) {
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState(null);

  const run = useCallback(async (key, fn, success) => {
    setBusy(key);
    try {
      const answer = await fn();
      if (success) showSuccess(success(answer));
      if (onChanged) await onChanged();
      return true;
    } catch (err) {
      showError(err?.message || 'Action impossible.');
      // The screen may be stale (another session consumed the proposal): show what the server holds now.
      if (onChanged) { try { await onChanged(); } catch { /* the error is already shown */ } }
      return false;
    } finally {
      setBusy(null);
    }
  }, [onChanged, showError, showSuccess]);

  const link = useCallback((key, transactionId, allocations) => run(key,
    () => api.confirmReconciliation({ transactionId, allocations }),
    (answer) => (answer && answer.marked && answer.marked.length > 0 ? 'Rapproché. La fiche est marquée reçue.' : 'Rapproché.')), [run]);

  const linkBatch = useCallback((key, pairs) => run(key, () => api.linkReconciliationBatch({ pairs }),
    (answer) => (answer && answer.marked && answer.marked.length > 0 ? 'Rapproché. La fiche est marquée reçue.' : 'Rapproché.')), [run]);

  const confirmAll = useCallback(async ({ proposalIds, amounts }) => {
    setBusy('bulk');
    try {
      const answer = await api.confirmAllReconciliation({ proposalIds, amounts });
      const n = answer.confirmed.length;
      const skipped = answer.skipped.length;
      const word = (k) => `${k} rapprochement${k > 1 ? 's' : ''} confirmé${k > 1 ? 's' : ''}`;
      if (skipped === 0) showSuccess(word(n));
      else showError(`${n} confirmé${n > 1 ? 's' : ''} · ${skipped} non confirmé${skipped > 1 ? 's' : ''} — voir la liste`);
      if (onChanged) await onChanged();
      return answer;
    } catch (err) {
      showError(err?.message || 'Action impossible.');
      if (onChanged) { try { await onChanged(); } catch { /* the error is already shown */ } }
      return null;
    } finally {
      setBusy(null);
    }
  }, [onChanged, showError, showSuccess]);

  const confirm = useCallback((item) => link(item.key, item.proposal.bank.transactionId,
    item.proposal.allocations.map((a) => ({ reservationId: a.reservationId, ledgerKey: a.ledgerKey, amountCents: a.amountCents }))), [link]);

  const discard = useCallback((item) => run(item.key, () => api.discardReconciliation({
    transactionId: item.proposal.bank.transactionId, reservationId: item.reservation.id, ledgerKey: item.ledgerKey,
  })), [run]);

  const undo = useCallback((item) => run(item.key, async () => {
    const ids = [...new Set(item.bank.map((b) => b.transactionId))];
    let last = null;
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      last = await api.undoReconciliation(id);
    }
    return last;
  }, (answer) => (answer && answer.untouched && answer.untouched.length > 0
    ? 'Rapprochement défait. Fiche modifiée depuis : à vérifier à la main.' : 'Rapprochement défait.')), [run]);

  const setOutside = useCallback((credit, outside) => run(credit.transactionId, () => api.setReconciliationOutside(credit.transactionId, outside)), [run]);

  return { busy, link, linkBatch, confirmAll, confirm, discard, undo, setOutside };
}
