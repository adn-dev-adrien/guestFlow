/**
 * specs/reservation-refunds.md rule 52 (audit R23 N7, 2026-11-05) — taking a mark back must not leave book refunds above what
 * stays collected: the reverse order of rule 50, which left a negative collected and negative revenue in the journal. Shared
 * by the payment PATCH, the arrival undo and the reconciliation's « Défaire ».
 */
const { untickRefusal: judgeUntickRefusal } = require('./pricing/refunds/judge');

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
  return judgeUntickRefusal(row, changes, refunds, projectedSplit);
}

module.exports = { untickRefusal };
