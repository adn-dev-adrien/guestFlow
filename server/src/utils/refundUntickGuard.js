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

/**
 * @param {object} row     the stay as stored
 * @param {object} changes the columns the gesture would write
 * @param {Array}  refunds the stay's register
 * @returns {{status: number, body: object}|null} the refusal, or null
 */
function untickRefusal(row, changes, refunds) {
  const book = (refunds || []).filter((refund) => !isOffBooks(refund.method) && !isRetainedDeposit(refund.method));
  const before = comptaCollected({ ...row, refundsBookTtc: 0 });
  const after = comptaCollected({ ...row, ...changes, refundsBookTtc: 0 });
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
