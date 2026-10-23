/**
 * The core's payment mark, callable without a request (specs/qonto-bank-reconciliation.md rule 34).
 *
 * « Marquer perçu » of the fiche is `PATCH /reservations/:id/payment`; a plugin that records a payment
 * the operator confirmed must go through the very same code — every guard, the contribution capture, the
 * payout and commission written with the solde (and their history entry) — not through a copy of it.
 * `updatePayment` writes no history entry for the acompte or solde mark itself: the paid flag and its
 * date are the trace. This adapter hands `updatePayment` a request-shaped object and returns what it
 * would have answered, so the fiche's behaviour is untouched.
 */

const { computePlatformCommission } = require('./platformCommission');

/**
 * @param {object} p
 * @param {number} p.reservationId
 * @param {object} p.body   the PATCH body (`balancePaid`, `balancePaidDate`, `expectedAmountCents`…)
 * @param {object} p.user   the signed operator (`req.user`)
 * @returns {{ status: number, body: object }}
 */
function applyPaymentMark({ reservationId, body, user }) {
  // Required lazily: the controller pulls most of the core, and this module is loaded by the SDK.
  const controller = require('../controllers/reservationsController');
  let status = 200;
  let payload = null;
  const res = {
    status(code) { status = code; return res; },
    json(value) { payload = value; return res; },
  };
  controller.updatePayment({ params: { id: String(reservationId) }, body: { ...body }, user }, res);
  return { status, body: payload };
}

module.exports = { applyPaymentMark, computePlatformCommission };
