/**
 * A payment received on a link withdrawn by hand, AFTER its withdrawal (specs/payment-link-lifecycle.md rule 56,
 * decided by Adrien 2026-10-31). The poll found it paid (rule 8 alert): the money is not the stay's, and no new
 * payment request of the stay leaves until the operator settles it.
 *
 *   unsettledWithdrawnRefusal(database, stayId) → { httpStatus: 409, error: 'UNSETTLED_WITHDRAWN_PAYMENT', message } | null
 *   settleWithdrawnPayment(linkId, { database, paymentLinksModel, outcome: 'stay' | 'refunded', bookPaid }) → { link }
 *
 * Unsettled: `status = 'cancelled'`, `cancelReason = 'operator'`, a `paidAt`. Settled: `refunded` turns the reason
 * into `refunded` (the money stays off the stay, the payment id stays on the row); `stay` books it as the stay's
 * money through `bookPaid(link, payment)`, the poll's late booking (`cancelled → paid`) — refused (409
 * `STAY_READ_ONLY`) on a cancelled or set-aside stay, where only the refund is recorded.
 */

const { LINK_REASONS } = require('../constants/paymentLinks');
const { withConvertedDevis } = require('./deletionGuard');

const UNSETTLED = Object.freeze({
  httpStatus: 409,
  error: 'UNSETTLED_WITHDRAWN_PAYMENT',
  message: 'Paiement reçu sur un lien retiré : à traiter avant toute nouvelle demande.',
});

const UNSETTLED_SQL = "status = 'cancelled' AND cancelReason = ? AND paidAt IS NOT NULL";
const OUTCOMES = new Set(['stay', 'refunded']);

function unsettledWithdrawnRefusal(database, stayId) {
  const owners = withConvertedDevis(database, [Number(stayId)]);
  const hit = database.prepare(`
    SELECT 1 FROM payment_links WHERE reservationId IN (${owners.map(() => '?').join(', ')}) AND ${UNSETTLED_SQL} LIMIT 1
  `).get(...owners, LINK_REASONS.OPERATOR);
  return hit ? { ...UNSETTLED } : null;
}

const isUnsettled = (link) => Boolean(link) && link.status === 'cancelled' && link.cancelReason === LINK_REASONS.OPERATOR && Boolean(link.paidAt);

async function settleWithdrawnPayment(linkId, { database, paymentLinksModel, outcome, bookPaid }) {
  if (!OUTCOMES.has(outcome)) throw { httpStatus: 400, error: 'INVALID_OUTCOME', message: 'Issue invalide (stay/refunded).' };
  const link = paymentLinksModel.findById(Number(linkId));
  if (!link) throw { httpStatus: 404, error: 'LINK_NOT_FOUND', message: 'Lien de paiement introuvable.' };
  if (!isUnsettled(link)) throw { httpStatus: 409, error: 'NOTHING_TO_SETTLE', message: 'Aucun paiement à traiter sur ce lien.' };
  // Review of #902 (O2) — a cancelled or set-aside stay can record the refund, never take the money as its own.
  const { stayKindOf, READ_ONLY_KINDS } = require('./paymentLinkWithdrawal');
  if (outcome === 'stay' && READ_ONLY_KINDS.has(stayKindOf(database, link.reservationId))) {
    throw { httpStatus: 409, error: 'STAY_READ_ONLY', message: 'Séjour en lecture seule : paiement à rembourser.' };
  }
  if (outcome === 'refunded') {
    const info = database.prepare(`UPDATE payment_links SET cancelReason = ? WHERE id = ? AND ${UNSETTLED_SQL}`)
      .run(LINK_REASONS.REFUNDED, link.id, LINK_REASONS.OPERATOR);
    if (Number(info.changes) === 0) throw { httpStatus: 409, error: 'NOTHING_TO_SETTLE', message: 'Aucun paiement à traiter sur ce lien.' };
  } else {
    await bookPaid(link, { paid: true, paymentId: link.providerPaymentId, paidAt: link.paidAt });
  }
  return { link: paymentLinksModel.findById(link.id) };
}

module.exports = { unsettledWithdrawnRefusal, settleWithdrawnPayment, isUnsettled, UNSETTLED };
