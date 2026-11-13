/**
 * specs/payment-schedule-and-cancellation.md rule 61 (audits R44-DB-M1, R44-M-L1, R44-RES-L1) — the sum a guest e-mail
 * states as kept by a cancellation (`{{retainedDepositAmount}}`, `hasRetainedDeposit`), read from the cancellation's own
 * figures, never worked out by the e-mail:
 *   - a cancelled stay: the `keptFromGuest` its cancel entry stored (an older entry: its « Acompte conservé »), less
 *     what the refunds made since the cancel took from it (rule 62), never below 0;
 *   - a live direct stay: what cancelling it now would keep (`cancellationPreview`, the function the cancel writes from),
 *     for the reminders that say what an unpaid solde would cost;
 *   - anything else (a devis, a platform booking the cancel refuses): 0.
 */

const { cancellationPreview } = require('./cancelReservation');
const { givenBackSinceCancelOf } = require('./pricing/refunds/cancellation');
const { isDirectChannel } = require('./platformNameFormat');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function storedKeptOf(database, reservationId) {
  const entry = database.prepare(`
    SELECT changedFields FROM reservation_history
     WHERE reservationId = ? AND eventType = 'cancel'
     ORDER BY id DESC LIMIT 1
  `).get(Number(reservationId));
  if (!entry) return { kept: 0, withCash: false };
  let changes = [];
  try { changes = JSON.parse(entry.changedFields || '[]'); } catch { return { kept: 0, withCash: false }; }
  const valueOf = (field) => {
    const change = (Array.isArray(changes) ? changes : []).find((c) => c && c.field === field);
    return change && change.to != null && Number.isFinite(Number(change.to)) ? Number(change.to) : null;
  };
  const kept = valueOf('keptFromGuest');
  return { kept: Math.max(0, round2(kept != null ? kept : (valueOf('retainedDeposit') || 0))), withCash: kept != null };
}

// Rule 62 (verification R44 L2) — what the refunds made since the cancel took from the sum it kept (D3): a book refund
// its lines drawn from the indemnity, a caisse-interne refund the part of the caisse acompte the other caisse money no
// longer covers (rule 61's order) — only when the figure stored holds it (an entry older than rule 61 does not). A
// refund of money the cancel did not keep (a paid solde) takes nothing.
function givenBackSinceCancel(database, reservationId, { withCash }) {
  const row = require('../models/reservationsModel').create(database).getForCancellation(Number(reservationId));
  if (!row) return 0;
  const refunds = require('../models/refundsModel').createModel(database).listByReservation(Number(reservationId));
  return givenBackSinceCancelOf({ row, refunds, withCash });
}

function cancelledKeptOf(database, reservationId) {
  const stored = storedKeptOf(database, reservationId);
  return Math.max(0, round2(stored.kept - givenBackSinceCancel(database, reservationId, stored)));
}

function liveKeptOf(database, reservation) {
  const deps = {
    database,
    reservationsModel: require('../models/reservationsModel').create(database),
    refundsModel: require('../models/refundsModel').createModel(database),
    installmentsModel: require('../models/installmentsModel').buildModel(database),
  };
  const { getTodayIsoDate } = require('./reservationHelpers');
  const vatRate = require('../models/vatRegimeModel').rateForRow(database, { id: Number(reservation.id) });
  const preview = cancellationPreview(deps, reservation.id, { today: getTodayIsoDate(), vatRate });
  return preview.ok ? Math.max(0, round2(preview.keptFromGuest)) : 0;
}

function cancellationKeptForEmail(database, reservation) {
  if (!database || !reservation || reservation.id == null) return 0;
  try {
    if (String(reservation.kind) === 'cancelled') return cancelledKeptOf(database, reservation.id);
    if (String(reservation.kind) !== 'reservation' || !isDirectChannel(reservation.platform)) return 0;
    return liveKeptOf(database, reservation);
  } catch (err) {
    // A stay the figures cannot be read for states no sum: the sentence is left out, never a guessed amount.
    console.error('[cancellation-kept] figure unavailable:', err && err.message);
    return 0;
  }
}

module.exports = { cancellationKeptForEmail };
