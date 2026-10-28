/**
 * Allocation of ticked credits over open receipts (specs/reconciliation-assisted-matching.md rules 5–9, 18).
 *
 * Pure: credits × receipts → pairs, the state each receipt would reach, and what is left on each credit.
 * A credit that fits one receipt to the cent goes there; the rest is first in, first out — the oldest
 * credit onto the earliest due receipt, an installment plan following its own order (rule 9). A receipt
 * is `covered` only once its confirmed lines reach what the fiche expects (v1 rule 37).
 *
 * Receipt shape: `{ key, reservationId, ledgerKey, label, capCents, needCents, tolerance, unbounded, anchor, order }`
 *  - `capCents`   the most a pair may carry (what is still open)
 *  - `needCents`  what completes it (the bank amount minus what is already reconciled)
 *  - `unbounded`  a platform payout the fiche does not carry yet: the credit IS the payout (v1 rule 36)
 */

const { euros } = require('./receiptStates');

const byDue = (a, b) => (a.anchor || '9999').localeCompare(b.anchor || '9999') || a.order - b.order;

function emptyState(receipts) {
  return new Map(receipts.map((r) => [r.key, { receipt: r, cents: 0 }]));
}

/** Rules 5, 9 — the default allocation of `credits` (oldest first) over `receipts`. */
function allocateFifo({ credits, receipts }) {
  const queue = [...receipts].sort(byDue);
  const left = new Map(credits.map((c) => [c.transactionId, c.remainingCents]));
  const need = new Map(queue.map((r) => [r.key, r.unbounded ? Infinity : r.needCents]));
  const ordered = [...credits].sort((a, b) => String(a.settledAt).localeCompare(String(b.settledAt)));
  const pairs = [];
  const push = (credit, receipt, cents) => {
    if (cents <= 0) return;
    pairs.push({ transactionId: credit.transactionId, reservationId: receipt.reservationId, ledgerKey: receipt.ledgerKey, amountCents: cents });
    left.set(credit.transactionId, left.get(credit.transactionId) - cents);
    need.set(receipt.key, need.get(receipt.key) - cents);
  };

  ordered.forEach((credit) => {
    const exact = queue.find((r) => !r.unbounded && need.get(r.key) > 0 && need.get(r.key) === left.get(credit.transactionId));
    if (exact) push(credit, exact, left.get(credit.transactionId));
  });
  ordered.forEach((credit) => {
    queue.forEach((receipt) => {
      const available = left.get(credit.transactionId);
      if (available <= 0 || need.get(receipt.key) <= 0) return;
      push(credit, receipt, Math.min(available, need.get(receipt.key)));
    });
  });
  return pairs;
}

/** What the pairs would leave: per receipt covered / partial, per credit the cents still available. */
function summarize({ credits, receipts, pairs }) {
  const state = emptyState(receipts);
  const used = new Map();
  pairs.forEach((p) => {
    const hit = state.get(`${p.reservationId}|${p.ledgerKey}`);
    if (hit) hit.cents += p.amountCents;
    used.set(p.transactionId, (used.get(p.transactionId) || 0) + p.amountCents);
  });
  const touched = [...state.values()].filter((s) => s.cents > 0).sort((a, b) => byDue(a.receipt, b.receipt));
  const receiptsOut = touched.map(({ receipt, cents }) => {
    const covered = receipt.unbounded || cents >= receipt.needCents - receipt.tolerance;
    return {
      key: receipt.key, label: receipt.label, expectedCents: receipt.needCents, coveredCents: cents,
      after: covered ? 'covered' : 'partial',
      statusLabel: covered ? 'couvert' : `${euros(cents)} sur ${euros(receipt.needCents)}`,
    };
  });
  const leftover = credits.map((c) => ({ credit: c, cents: c.remainingCents - (used.get(c.transactionId) || 0) }))
    .filter((l) => l.cents > 0 && used.has(l.credit.transactionId))
    .map((l) => ({
      transactionId: l.credit.transactionId, cents: l.cents, dateLabel: l.credit.dateLabel,
      message: `${euros(l.cents)} restent disponibles sur le virement du ${l.credit.dateLabel}`,
    }));
  const total = pairs.reduce((s, p) => s + p.amountCents, 0);
  const count = new Set(pairs.map((p) => p.transactionId)).size;
  return {
    receipts: receiptsOut, leftover, totalCents: total, creditCount: count,
    summaryLabel: count > 0 ? `${count} virement${count > 1 ? 's' : ''} · ${euros(total)}` : '',
  };
}

const err = (code, message, field = null) => ({ code, message, field });

/**
 * Rule 7 — the refusals of a set of pairs, in words. Empty = valid.
 * @param {object} p
 * @param {object[]} p.pairs     `{ transactionId, reservationId, ledgerKey, amountCents }`
 * @param {Map<string, object>} p.creditsById  `{ remainingCents, dateLabel }`
 * @param {Map<string, object>} p.receiptsByKey receipts (shape above)
 * @param {boolean} [p.enforceCap] refuse a pair above what the receipt still expects (the dialog); v1's single-credit link (rule 36) allows it
 */
function validatePairs({ pairs, creditsById, receiptsByKey, enforceCap = true }) {
  const errors = [];
  if (!Array.isArray(pairs) || pairs.length === 0) return [err('INVALID_ALLOCATION', 'Aucun montant à rattacher.')];
  const perCredit = new Map();
  const perReceipt = new Map();
  pairs.forEach((p, i) => {
    const field = `pairs.${i}`;
    if (!Number.isInteger(p.amountCents)) { errors.push(err('INVALID_ALLOCATION', 'Montant invalide : deux décimales au plus.', field)); return; }
    if (p.amountCents <= 0) { errors.push(err('INVALID_ALLOCATION', 'Le montant doit être supérieur à 0.', field)); return; }
    const credit = creditsById.get(String(p.transactionId));
    if (!credit) { errors.push(err('UNKNOWN_TRANSACTION', 'Virement introuvable.', field)); return; }
    const key = `${p.reservationId}|${p.ledgerKey}`;
    if (!receiptsByKey.has(key)) { errors.push(err('UNKNOWN_RECEIPT', 'Échéance inconnue ou hors du périmètre du rapprochement.', field)); return; }
    perCredit.set(credit.transactionId, (perCredit.get(credit.transactionId) || 0) + p.amountCents);
    perReceipt.set(key, (perReceipt.get(key) || 0) + p.amountCents);
  });
  perCredit.forEach((sum, id) => {
    const c = creditsById.get(id);
    if (sum > c.remainingCents) errors.push(err('ALLOCATION_EXCEEDS_TRANSACTION', `Le virement du ${c.dateLabel} n'a plus que ${euros(c.remainingCents)} à répartir.`, `credit.${id}`));
  });
  perReceipt.forEach((sum, key) => {
    const r = receiptsByKey.get(key);
    if (r.alreadyCovered) {
      errors.push(err('RECEIPT_ALREADY_COVERED', 'Cette échéance est déjà couverte par un autre virement.', `receipt.${key}`));
      return;
    }
    if (enforceCap && !r.unbounded && r.checkCap !== false && sum > r.capCents) {
      errors.push(err('ALLOCATION_EXCEEDS_RECEIPT', `${r.label} n'attend plus que ${euros(r.capCents)}.`, `receipt.${key}`));
    }
  });
  return errors;
}

module.exports = { allocateFifo, summarize, validatePairs };
