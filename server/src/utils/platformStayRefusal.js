/**
 * A platform stay never carries a direct payment (specs/payment-link-lifecycle.md rule 57, audit R9-M1): the
 * platform collects the stay, so a link would ask the guest to pay twice.
 *
 *   platformStayRefusal(database, stayId) → { httpStatus: 409, error: 'PLATFORM_RESERVATION', message } | null
 *
 * « Direct » is `isDirectChannel` (own channels included), read on the row and on the reservation a devis
 * became. A missing row is no refusal here (the callers answer their own 404).
 */

const { isDirectChannel } = require('./platformNameFormat');

const PLATFORM_RESERVATION = Object.freeze({ httpStatus: 409, error: 'PLATFORM_RESERVATION', message: 'Réservation plateforme : aucun lien de paiement.' });

function platformStayRefusal(database, stayId) {
  const row = database.prepare('SELECT platform, convertedReservationId FROM reservations WHERE id = ?').get(Number(stayId));
  if (!row) return null;
  const stay = row.convertedReservationId
    ? database.prepare('SELECT platform FROM reservations WHERE id = ?').get(Number(row.convertedReservationId))
    : null;
  const platformOwned = !isDirectChannel(row.platform) || Boolean(stay && !isDirectChannel(stay.platform));
  return platformOwned ? { ...PLATFORM_RESERVATION } : null;
}

module.exports = { platformStayRefusal, PLATFORM_RESERVATION };
