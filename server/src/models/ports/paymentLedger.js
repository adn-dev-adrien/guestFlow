/**
 * PaymentLedger — what a stay has been paid, as the pricing reads it (specs/pricing-components.md §3 rule 48).
 *
 * Contract (plain functions over today's reads; `create(db)` binds them to a database):
 *   installments(id)   the installment plan summary `{ count, scheduled, paid, allPaid }`, null without a plan
 *   splitReceived(id)  what each bucket paid with several methods actually received, null without a split
 *   refunds(id)        `{ book, withCash }` — book-money refunds vs everything including the caisse interne
 *   allocations(id)    the stay's `payment_allocations` rows, signed cents (rule 74); a stay a statement changed behind the
 *                      application's hooks is rebuilt first, so the read is never late
 *   receipts(id)       `{ allocations, settlements }` — everything received for the stay, in the one read that REFUNDS and
 *                      SETTLEMENT share (rule 48)
 */
const { readInstallmentSummary } = require('../../utils/installmentSummary');
const { readSplitReceived } = require('../../utils/splitReceived');
const { flushDirty } = require('../../utils/paymentAllocationsSync');

function allocationsOf(db, id) {
  const present = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'payment_allocations'").get();
  if (!present) return [];
  flushDirty(db, id);
  return db.prepare(`SELECT paymentRef, lineRef, amountCents, kind, refundId, books, at FROM payment_allocations
    WHERE documentRef = ? ORDER BY id`).all(`reservation:${Number(id)}`);
}

function create(db) {
  return {
    allocations: (id) => allocationsOf(db, id),
    receipts: (id) => ({
      allocations: allocationsOf(db, id),
      settlements: require('../paymentSettlementsModel').buildModel(db).listFor(id),
    }),
    installments: (id) => readInstallmentSummary(db, id),
    splitReceived: (id) => readSplitReceived(db, id),
    refunds: (id) => require('../refundsModel').createModel(db).totalsByReservation(id),
  };
}

module.exports = { create };
