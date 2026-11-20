// The stored trop-perçu of a stay in euros, through the one formula of specs/pricing-components.md §3 rule 76 (the stay's
// allocations less its stored total): what the suites read where they used to hand a row to the pure function.
// A database built from `schema.sql` alone holds no allocation table (the boot's migration creates it): it is brought up like
// the application's boot does it, with the stay-level backfill standing in for the writes that happened before.
const { overpayment } = require('../../utils/pricing/refunds/overpayment');
const { overpaymentContext } = require('../../models/refundInputModel');
const lines = require('../../utils/pricingLinesMigration');

function boot(db) {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'payment_allocations'").get()) return;
  lines.runPricingLinesMigration(db);
  lines.backfillStayLevelAllocations(db);
}

module.exports = {
  storedOverpaymentTtc: (db, id, { autoComplementCents = 0 } = {}) => {
    boot(db);
    return overpayment(overpaymentContext(db, id, { autoComplementCents })).cents / 100;
  },
};
