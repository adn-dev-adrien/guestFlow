/**
 * The 409 a write on a read-only stay answers (specs/payment-schedule-and-cancellation.md §3.5 rule 25 and
 * specs/calendar-property-parity.md rule 22).
 *
 * A cancelled stay is history: its amounts and échéances are what accounting still reads and its dates are
 * back on sale. A duplicate set aside is not a stay at all any more: nothing may be collected, sent,
 * checked in or refunded on it. A route says which of the two it refuses: a write that never makes sense on
 * either (the fiche save, a payment mark, the SAS, a payment link) refuses both; one that cancelled stays
 * legitimately receive (a refund, the cancellation email) refuses only the duplicate.
 */

const MESSAGES = {
  cancelled: { error: 'Cette réservation est annulée et ne peut plus être modifiée.', code: 'RESERVATION_CANCELLED' },
  superseded: { error: 'Ce doublon est écarté : le rétablir pour le modifier.', code: 'RESERVATION_SUPERSEDED' },
};

/**
 * @param {object} database better-sqlite3 handle
 * @param {number|string} reservationId
 * @param {{ cancelled?: boolean }} [options] `cancelled: false` lets a cancelled stay through
 * @returns {{ status: 409, body: { error: string, code: string } } | null}
 */
function refusalForKind(kind, { cancelled = true } = {}) {
  const value = String(kind || '');
  if (value === 'superseded' || (cancelled && value === 'cancelled')) return { status: 409, body: MESSAGES[value] };
  return null;
}

function readOnlyRefusal(database, reservationId, options) {
  const row = database.prepare('SELECT kind FROM reservations WHERE id = ?').get(Number(reservationId));
  return refusalForKind(row && row.kind, options);
}

/** Sends the refusal when there is one; true when the route must stop. */
function refuseIfReadOnly(res, database, reservationId, options) {
  const refusal = readOnlyRefusal(database, reservationId, options);
  if (!refusal) return false;
  res.status(refusal.status).json(refusal.body);
  return true;
}

/**
 * Route middleware: refuses a write on `:id` (or the id `idOf(req)` reads) before the handler runs.
 * The refusal is checked on the stay itself, so an unknown id falls through to the handler's own 404.
 */
function guardReadOnly(database, options, idOf = (req) => req.params.id) {
  return (req, res, next) => (refuseIfReadOnly(res, database, idOf(req), options) ? undefined : next());
}

module.exports = { refusalForKind, readOnlyRefusal, refuseIfReadOnly, guardReadOnly };
