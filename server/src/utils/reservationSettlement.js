/**
 * Per-bucket settlement rules of a reservation — the single source of truth shared by the finance
 * views (specs/finance-overview-rework.md §3.3, specs/finance-operational-remaining-to-pay.md) and
 * the day-of-operations collection status (specs/dashboard-collection-alert.md).
 *
 * A reservation is paid through four buckets: acompte, solde, complément d'arrivée, complément de
 * fin de séjour. Each one is either NOT APPLICABLE (zero amount, or a deposit opted out for this
 * reservation) or applicable and then settled/pending. « Settled » includes the caisse-interne
 * complements (specs/cash-complement-and-endofstay-finance.md) — the money was collected, it just
 * stays off-books.
 *
 * Pure functions — unit-tested in tests/reservation-settlement.unit.test.js.
 */

const { parseNotes } = require('./midStayExtras');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Operator-entered platform commission (acompte + solde), ≥ 0. 0 on direct bookings (NULL columns).
function platformCommission(r) {
  return round2(Number(r.acompteCommissionAmount || 0) + Number(r.platformCommissionAmount || 0));
}

/**
 * @param {object} r reservation row carrying the amount + paid columns of the four buckets.
 * @returns {{deposit:object, balance:object, complement:object, endOfStay:object}} each
 *          `{ amount, applicable, settled }` — `applicable` false means there is nothing to collect.
 */
function bucketStates(r = {}) {
  const deposit = round2(r.depositAmount);
  const balance = round2(r.balanceAmount);
  const complement = round2(r.complementAmount);
  const endOfStay = round2(r.endOfStayComplementAmount);
  return {
    // A deposit disabled per reservation (specs/disable-deposit-per-reservation.md) has literally
    // nothing to collect — not applicable rather than "settled".
    deposit: {
      amount: deposit,
      applicable: deposit > 0 && !r.depositDisabled,
      settled: Boolean(r.depositPaid),
    },
    balance: {
      amount: balance,
      applicable: balance > 0,
      settled: Boolean(r.balancePaid),
    },
    complement: {
      amount: complement,
      applicable: complement > 0,
      settled: Boolean(r.complementPaid) || Boolean(r.complementPaidCash),
    },
    endOfStay: {
      amount: endOfStay,
      applicable: endOfStay > 0,
      settled: Boolean(r.endOfStayComplementPaid) || Boolean(r.endOfStayComplementPaidCash),
    },
  };
}

// specs/finance-overview-rework.md §3.3 — a reservation is « soldé » when every applicable component
// is paid OR marked caisse interne. A non-applicable component is trivially settled.
function isSettled(r) {
  return Object.values(bucketStates(r)).every((b) => !b.applicable || b.settled);
}

// « Reste à payer » = the real outstanding amount (specs/finance-operational-remaining-to-pay.md §3):
// the SUM of the still-owed buckets only — a bucket already paid (incl. a caisse-interne complement)
// or a disabled deposit is NOT counted. Equals 0 exactly when isSettled(r) is true. This is the
// counterpart of comptaCollected and is what the « Suivi opérationnel » must show (the shared
// computePaymentStatus.remainingDue only nets deposit + balance and ignores the complements).
function remainingToPay(r) {
  // Net of the platform commission of each STILL-UNPAID échéance, so it stays consistent with the
  // « total perçu » : comptaCollected(r) + remainingToPay(r) === totalSejour(r). Direct → commission 0.
  // The commission is subtracted whatever the bucket amount (a zero bucket carrying a commission is
  // degenerate data, but the invariant above must hold on it too) — hence the raw flags here rather
  // than bucketStates' `applicable`.
  const acompteComm = Number(r.acompteCommissionAmount || 0);
  const soldeComm = Number(r.platformCommissionAmount || 0);
  const deposit = (!r.depositDisabled && !r.depositPaid) ? Number(r.depositAmount || 0) - acompteComm : 0;
  const balance = !r.balancePaid ? Number(r.balanceAmount || 0) - soldeComm : 0;
  const complement = (!r.complementPaid && !r.complementPaidCash) ? Number(r.complementAmount || 0) : 0;
  const endOfStay = (!r.endOfStayComplementPaid && !r.endOfStayComplementPaidCash) ? Number(r.endOfStayComplementAmount || 0) : 0;
  return round2(deposit + balance + complement + endOfStay);
}

// « Notes en séjour » already collected (specs/mid-stay-notes.md §3.4 rule 15): book money by
// default, caisse-interne ones only when explicitly asked for.
function midStayNotesTotal(r, { withCash = false } = {}) {
  return round2(parseNotes(r.midStaySettledNotes)
    .filter((n) => withCash || Number(n.paidCash || 0) === 0)
    .reduce((s, n) => s + (Number(n.total) || 0), 0));
}

// specs/reservation-refunds.md §3.3 rule 19 — book-money refunds (virement / espèces) already given
// back. Rows read without the refund columns (minimal test schemas) degrade to 0.
function refundsBook(r) {
  return round2(Number(r.refundsBookTtc || 0));
}

// « Encaissé » = what the operator has actually RECEIVED so far = every component marked paid,
// EXCLUDING caisse interne, NET of the platform commission of each paid échéance and NET of the
// refunds already sent back. Direct → commission 0 → the plain paid sum.
function comptaCollected(r) {
  const acompteComm = Number(r.acompteCommissionAmount || 0);
  const soldeComm = Number(r.platformCommissionAmount || 0);
  return round2(
    (r.depositPaid ? Number(r.depositAmount || 0) - acompteComm : 0)
    + (r.balancePaid ? Number(r.balanceAmount || 0) - soldeComm : 0)
    + (r.complementPaid && !r.complementPaidCash ? Number(r.complementAmount || 0) : 0)
    + (r.endOfStayComplementPaid && !r.endOfStayComplementPaidCash ? Number(r.endOfStayComplementAmount || 0) : 0)
    // A note only exists once collected — it is never « pending » (specs/mid-stay-notes.md rule 16).
    + midStayNotesTotal(r)
    // …and a refund is money already given back (specs/reservation-refunds.md rule 18).
    - refundsBook(r),
  );
}

module.exports = {
  bucketStates, isSettled, remainingToPay, platformCommission,
  midStayNotesTotal, refundsBook, comptaCollected, round2,
};
