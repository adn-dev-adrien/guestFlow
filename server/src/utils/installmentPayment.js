/**
 * The one way an installment is recorded as collected (specs/direct-installments.md rules 15-16).
 *
 * A link paid online and a payment ticked by hand on the fiche both end here: the installment is flipped
 * once (a replayed webhook records nothing twice), the stay's aggregates follow, the installment's open
 * link is retired, and `reservation.paid` is announced like for the other buckets.
 */

const { buildModel } = require('../models/installmentsModel');
const { buildModel: buildLinksModel } = require('../models/paymentLinksModel');
const { rebalanceStored } = require('./installmentSync');
const { todayIso } = require('./localDate');
const { computeInstallmentPaidSplit } = require('./installmentPaidSplit');

/**
 * @param {{ db: object, emit?: Function }} deps
 * @param {{ installmentId: number, paidDate?: string, method: string, amountCents?: number }} payment
 *   `amountCents` is the money really received when it differs from the installment (a link retired for an
 *   amount change, paid anyway): the installment then takes that amount, pinned.
 * @returns {{ found: boolean, flipped: boolean, reservationId?: number }}  `found: false` — the installment
 *   is gone (plan removed or resized): the money has no row to land on.
 */
function recordInstallmentPayment({ db, emit }, { installmentId, paidDate, method, amountCents = null }) {
  const model = buildModel(db);
  const row = model.findById(installmentId);
  if (!row) return { found: false, flipped: false };
  let flipped = false;
  db.transaction(() => {
    if (Number(row.paid) === 1) return;
    const differs = amountCents != null && Number(amountCents) !== Number(row.amountCents);
    if (differs) model.updateRow(installmentId, { amountCents: Number(amountCents), amountEdited: 1 });
    flipped = model.markPaid(installmentId, { paidDate: paidDate || todayIso(), method }).flipped;
    if (flipped && differs) rebalanceStored(db, row.reservationId);
    // Rule 47 — the books read this split, never a live one: a later save cannot move the entry.
    if (flipped) model.setPaidSplit(installmentId, computeInstallmentPaidSplit(db, installmentId));
  }).immediate();
  if (flipped) {
    buildLinksModel(db).retireSettled();
    if (emit) emit('reservation.paid', { reservationId: row.reservationId, bucket: 'installment' });
  }
  return { found: true, flipped, reservationId: row.reservationId };
}

module.exports = { recordInstallmentPayment };
