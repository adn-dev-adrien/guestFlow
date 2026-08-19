/**
 * Automatic acompte request at booking (specs/payment-schedule-and-cancellation.md §3.7 rule 36).
 *
 * The acompte is what turns dates into a commitment, and it is now due `depositDueDays` after the
 * booking — so asking for it must happen at the booking, not when the operator remembers to press
 * « Envoyer la demande d'acompte ». This runs right after a reservation is created.
 *
 * It is deliberately best-effort: the request is already answered by then, and a missing SMTP
 * configuration, an unreachable Qonto or a client without an email address must never turn a
 * successful booking into a failed one. Every skip reason is returned (and logged by the caller)
 * rather than thrown.
 *
 * Pure orchestration — `sendDepositRequest` and the reservation lookup are injected, so the whole
 * decision table is unit-testable without SMTP, Qonto or the production DB.
 */

const { isDirectChannel } = require('./platformNameFormat');

/**
 * @param {object}   deps
 * @param {function} deps.getReservation      (id) → row with kind, platform, depositAmount,
 *                                            depositPaid, depositDisabled, clientEmail
 * @param {function} deps.sendDepositRequest  (id) → Promise<{ httpStatus }>
 * @param {function} [deps.onError]           (reason, error) → void — logging hook
 * @param {number}   reservationId
 * @returns {Promise<{sent:boolean, reason?:string, httpStatus?:number}>}
 */
async function requestDepositOnBooking(deps, reservationId) {
  const { getReservation, sendDepositRequest, onError } = deps || {};
  const row = getReservation(Number(reservationId));

  if (!row) return { sent: false, reason: 'no-reservation' };
  if (String(row.kind || 'reservation') !== 'reservation') return { sent: false, reason: 'not-a-reservation' };
  // A platform booking is settled by the platform after the stay — there is no acompte to ask for.
  if (!isDirectChannel(row.platform)) return { sent: false, reason: 'platform-booking' };
  if (Number(row.depositDisabled || 0) === 1) return { sent: false, reason: 'deposit-disabled' };
  if (Number(row.depositAmount || 0) <= 0) return { sent: false, reason: 'no-deposit' };
  // Converted from a devis whose acompte was already paid online: the guest owes nothing here.
  if (Number(row.depositPaid || 0) === 1) return { sent: false, reason: 'already-paid' };
  if (!String(row.clientEmail || '').trim()) return { sent: false, reason: 'no-email' };

  try {
    const out = await sendDepositRequest(Number(reservationId));
    const httpStatus = out && out.httpStatus;
    if (httpStatus === 200) return { sent: true, httpStatus };
    return { sent: false, reason: 'send-failed', httpStatus };
  } catch (err) {
    if (typeof onError === 'function') onError('send-error', err);
    return { sent: false, reason: 'send-error' };
  }
}

module.exports = { requestDepositOnBooking };
