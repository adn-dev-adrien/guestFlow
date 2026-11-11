/**
 * specs/reservation-refunds.md rule 52 (audit R23 N7, 2026-11-05) — taking a mark back must not leave book refunds above what
 * stays collected: the reverse order of rule 50, which left a negative collected and negative revenue in the journal. Shared
 * by the payment PATCH, the arrival undo and the reconciliation's « Défaire ».
 */
const { comptaCollected } = require('./reservationSettlement');
const { isOffBooks, isRetainedDeposit, round2 } = require('./refunds');
const { formatEuros } = require('./reservationLedger');

const frenchDay = (iso) => {
  const [year, month, day] = String(iso || '').slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
};

// The split aggregates once the gesture is written; without the settlements table, every one of them goes.
function projectedSplit(nextRow) {
  const settlements = require('../models/paymentSettlementsModel');
  const projected = typeof settlements.projectedAggregates === 'function' ? settlements.projectedAggregates(nextRow) : null;
  return projected || { splitOffBooksAmount: 0, splitWaivedAmount: 0, splitShortfallDue: 0 };
}

/**
 * @param {object} row     the stay as stored
 * @param {object} changes the columns the gesture would write
 * @param {Array}  refunds the stay's register
 * @returns {{status: number, body: object}|null} the refusal, or null
 */
function untickRefusal(row, changes, refunds) {
  const book = (refunds || []).filter((refund) => !isOffBooks(refund.method) && !isRetainedDeposit(refund.method));
  // Nothing refunded on the books: nothing to protect (rule 52 reading « nothing refunded = as before »).
  if (book.length === 0) return null;
  const before = comptaCollected({ ...row, refundsBookTtc: 0 });
  // specs/mixed-method-payments.md rules 13, 42 — the split aggregates are read for the state the gesture writes: a
  // payment taken back takes its settlement with it (only ITS settlements: the other split payments of the stay keep
  // their deduction), and an amount that moves is read at its new amount (rule 39).
  const splitAfter = projectedSplit({ ...row, ...changes });
  const after = comptaCollected({ ...row, ...changes, ...splitAfter, refundsBookTtc: 0 });
  if (after >= before) return null;
  let shortfall = round2(book.reduce((sum, refund) => sum + Number(refund.totalTtc || 0), 0) - after);
  if (shortfall <= 0) return null;
  const named = [];
  for (const refund of [...book].sort((a, b) => Number(b.id) - Number(a.id))) {
    if (shortfall <= 0) break;
    named.push(refund);
    shortfall = round2(shortfall - Number(refund.totalTtc || 0));
  }
  const list = named.map((refund) => `du ${frenchDay(refund.refundDate)} (${formatEuros(refund.totalTtc)})`).join(', ');
  return {
    status: 409,
    body: {
      error: `${named.length > 1 ? 'Remboursements' : 'Remboursement'} ${list} à supprimer d’abord.`,
      code: 'REFUND_BLOCKS_UNTICK',
      refundIds: named.map((refund) => refund.id),
    },
  };
}

module.exports = { untickRefusal };
