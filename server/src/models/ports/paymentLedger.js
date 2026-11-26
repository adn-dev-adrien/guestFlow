/**
 * PaymentLedger — what a stay has been paid, as the pricing reads it (specs/pricing/pricing-components.md §3 rule 48).
 *
 * Contract (plain functions over today's reads; `create(db)` binds them to a database):
 *   installments(id)   the installment plan summary `{ count, scheduled, paid, allPaid }`, null without a plan
 *   splitReceived(id)  what each bucket paid with several methods actually received, null without a split (`receipts(id).splitReceived`)
 *   refunds(id)        `{ book, withCash }` — book-money refunds vs everything including the caisse interne
 *   allocations(id)    the stay's `payment_allocations` rows, signed cents (rule 74); a stay a statement changed behind the
 *                      application's hooks is rebuilt first, so the read is never late
 *   receipts(id)       `{ allocations, settlements, splitReceived }` — everything received for the stay, in the one read that
 *                      SCHEDULE, SETTLEMENT and REFUNDS share (rule 48): the split each bucket received, read on the handle; the
 *                      settlements and the allocations (rebuilt when stale) read once, only by a reader that asks for them
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

// The split is read on the handle alone (no model, no default database: the engine runs on any handle); the settlements and the
// allocations are read, once, only by a reader that asks for them (the allocations rebuild a stale stay first).
function receiptsOf(db, id) {
  let settlements;
  let allocations;
  return {
    get settlements() {
      if (settlements === undefined) settlements = Number(id) > 0 ? require('../paymentSettlementsModel').buildModel(db).listFor(id) : [];
      return settlements;
    },
    get allocations() {
      if (allocations === undefined) allocations = allocationsOf(db, id);
      return allocations;
    },
    splitReceived: readSplitReceived(db, id),
  };
}

function create(db) {
  return {
    allocations: (id) => allocationsOf(db, id),
    receipts: (id) => receiptsOf(db, id),
    installments: (id) => readInstallmentSummary(db, id),
    splitReceived: (id) => receiptsOf(db, id).splitReceived,
    refunds: (id) => require('../refundsModel').createModel(db).totalsByReservation(id),
  };
}

module.exports = { create };
