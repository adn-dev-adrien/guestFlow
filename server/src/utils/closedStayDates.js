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

module.exports = { closedDatesRefusal, CLOSED_DATES };
