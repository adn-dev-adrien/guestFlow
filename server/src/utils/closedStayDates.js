/**
 * A stay whose nights an establishment closure covers gets no payment link (specs/payment-link-lifecycle.md
 * rule 55): the guest could otherwise pay for closed nights, and a devis would convert onto them.
 *
 *   closedDatesRefusal(database, stayId) → { httpStatus: 409, error: 'CLOSED_DATES', message } | null
 *
 * One closed night is enough; an establishment-wide closure covers every logement. A missing row is no refusal
 * here (the callers answer their own 404).
 */

const establishmentClosuresModel = require('../models/establishmentClosuresModel');

const CLOSED_DATES = Object.freeze({ httpStatus: 409, error: 'CLOSED_DATES', message: 'Logement fermé sur ces dates : aucun lien créé.' });

function closedDatesRefusal(database, stayId) {
  const stay = database.prepare('SELECT propertyId, startDate, endDate FROM reservations WHERE id = ?').get(Number(stayId));
  if (!stay || !stay.startDate || !stay.endDate) return null;
  const closure = establishmentClosuresModel.create(database).findCoveringClosure(stay.propertyId, stay.startDate, stay.endDate);
  return closure ? { ...CLOSED_DATES } : null;
}

/**
 * Whether the nights of the stay a link answers for can still be sold to it (specs/payment-link-lifecycle.md
 * rules 42, 56; final check of #902, M1): 'closed' (rule 55), 'taken' (another stay holds them: `checkConflict`,
 * the poll's availability check), or null. A devis converted since answers as the reservation it became. The one
 * decision behind the ledger's « Enregistrer » message, « Enregistrer sur le séjour » and the poll's late booking.
 */
function unavailableNights(database, stayId, { checkConflict = null } = {}) {
  const row = database.prepare('SELECT convertedReservationId FROM reservations WHERE id = ?').get(Number(stayId));
  const answering = Number((row && row.convertedReservationId) || stayId);
  if (closedDatesRefusal(database, answering)) return 'closed';
  if (typeof checkConflict !== 'function') return null;
  try { return checkConflict({ reservationId: answering }) ? 'taken' : null; } catch { return null; }
}

module.exports = { closedDatesRefusal, unavailableNights, CLOSED_DATES };
