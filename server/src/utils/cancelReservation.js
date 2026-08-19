/**
 * The cancellation transaction (specs/payment-schedule-and-cancellation.md §3.5 / §3.6).
 *
 * Everything that must succeed or fail together, in one place, with every dependency injected so the
 * whole sequence is unit-testable against an in-memory database — no Qonto, no SMTP, no clock:
 *
 *   1. an audit entry naming what was cancelled, why, and the money involved;
 *   2. `kind` walks 'reservation' → 'cancelled'. That single flip is what frees the dates: every
 *      operational query in the app already filters `kind = 'reservation'` (availability, calendar,
 *      planning, laundry, linen, SAS, iCal export, Google Calendar, email queues), so the row leaves
 *      all of them at once — no query to hunt down, and none that can be forgotten;
 *   3. the requalification pair, when an acompte had actually been collected: an avoir reversing the
 *      séjour revenue + VAT, and an indemnity crediting the same sum VAT-free, both dated today;
 *   4. open payment links are cancelled — a dead stay must not stay payable.
 *
 * Amounts, échéances and paid flags are deliberately NOT touched: they are history now, and the
 * accounting reads still need them exactly as they were.
 *
 * Business failures are returned (`{ error, status }`), never thrown — the controller maps them to HTTP.
 */

const { buildCancellationRequalification } = require('./cancellationRequalification');
const { isDirectChannel } = require('./platformNameFormat');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Why the stay was cancelled — derived from the state of the money, not asked. The operator's own
// words travel separately, in `reason`.
function resolveCancellationReason(row) {
  const depositUnpaid = Number(row.depositAmount || 0) > 0 && !Number(row.depositPaid);
  const balanceUnpaid = Number(row.balanceAmount || 0) > 0 && !Number(row.balancePaid);
  if (balanceUnpaid) return 'unpaid_balance';
  if (depositUnpaid) return 'unpaid_deposit';
  return 'manual';
}

/**
 * @param {object} deps { database, reservationsModel, refundsModel, compensationsModel, paymentLinksModel }
 * @param {number} reservationId
 * @param {object} input { reason?, cancelledBy?, today, vatRate }
 */
function cancelReservation(deps, reservationId, { reason = '', cancelledBy = null, today, vatRate = 0 } = {}) {
  const { database, reservationsModel, refundsModel, compensationsModel, paymentLinksModel } = deps;
  const id = Number(reservationId);
  const row = reservationsModel.getForCancellation(id);

  if (!row) return { error: 'NOT_FOUND', status: 404, message: 'Réservation non trouvée' };
  if (String(row.kind) === 'cancelled') {
    return { error: 'ALREADY_CANCELLED', status: 409, message: 'Cette réservation est déjà annulée.' };
  }
  // A platform booking follows the platform's own cancellation policy, through the iCal alert flow
  // (specs/cancellation-compensation.md) — never this one.
  if (!isDirectChannel(row.platform)) {
    return { error: 'PLATFORM_RESERVATION', status: 403, message: "Une réservation plateforme s'annule depuis l'alerte iCal, pas ici." };
  }

  const cancellationReason = resolveCancellationReason(row);
  const trimmedReason = String(reason || '').trim();
  const requalification = buildCancellationRequalification({
    reservation: row,
    depositBuckets: reservationsModel.depositContribBuckets(id),
    cancellationDate: today,
    vatRate,
    reason: trimmedReason,
  });
  const retainedDepositAmount = requalification ? requalification.depositTtc : 0;
  const writtenOffBalance = Number(row.balancePaid) ? 0 : round2(row.balanceAmount);

  let refundId = null;
  let compensationId = null;
  database.transaction(() => {
    reservationsModel.addHistoryEntry(id, 'cancel', [
      { field: 'kind', label: 'Statut', from: 'Réservation', to: 'Annulée' },
      { field: 'cancellationReason', label: 'Motif', from: null, to: trimmedReason || cancellationReason },
      { field: 'retainedDeposit', label: 'Acompte conservé', from: null, to: retainedDepositAmount },
      { field: 'writtenOffBalance', label: 'Solde abandonné', from: null, to: writtenOffBalance },
    ]);
    reservationsModel.markCancelled(id, { reason: trimmedReason || cancellationReason, cancelledBy });
    if (requalification) {
      refundId = refundsModel.create(id, { ...requalification.refund, totalTtc: retainedDepositAmount });
      compensationId = compensationsModel.createReceived(requalification.compensation).id;
    }
    for (const link of paymentLinksModel.listForReservation(id)) {
      if (String(link.status) === 'open') paymentLinksModel.updateStatus(link.id, 'cancelled');
    }
  })();

  return {
    ok: true,
    cancellationReason,
    retainedDepositAmount,
    writtenOffBalance,
    refundId,
    compensationId,
    clientEmail: String(row.email || '').trim(),
  };
}

module.exports = { cancelReservation, resolveCancellationReason };
