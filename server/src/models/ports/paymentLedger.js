/**
 * PaymentLedger — what a stay has been paid, as the pricing reads it (specs/pricing-components.md §3 rule 48).
 *
 * Contract (plain functions over today's reads; `create(db)` binds them to a database):
 *   installments(id)   the installment plan summary `{ count, scheduled, paid, allPaid }`, null without a plan
 *   splitReceived(id)  what each bucket paid with several methods actually received, null without a split
 *   refunds(id)        `{ book, withCash }` — book-money refunds vs everything including the caisse interne
 *
 * `receipts(id)` of rule 48 arrives with SCHEDULE and SETTLEMENT, its only consumers.
 */
const { readInstallmentSummary } = require('../../utils/installmentSummary');
const { readSplitReceived } = require('../../utils/splitReceived');

function create(db) {
  return {
    installments: (id) => readInstallmentSummary(db, id),
    splitReceived: (id) => readSplitReceived(db, id),
    refunds: (id) => require('../refundsModel').createModel(db).totalsByReservation(id),
  };
}

module.exports = { create };
