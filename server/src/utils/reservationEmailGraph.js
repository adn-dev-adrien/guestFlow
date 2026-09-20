/**
 * The reservation graph every guest email renders from — one loader shared by the preview/send
 * controller, the payment confirmation and the guest email sequence, so the three paths can never
 * render the same template differently (specs/guest-email-sequence.md §4.1).
 *
 * Kind-agnostic on purpose: it loads a reservation or a devis (the deposit reminder targets devis).
 * Returns null when the row does not exist.
 */

const reservationsModel = require('../models/reservationsModel');
const { loadStayFacts } = require('../models/stayFactsModel');

// specs/j2-email-arrival-complement-line.md — the SAME arrival-complement breakdown the SAS shows.
// Guarded: `getByIdWithDetails` needs the full schema, so on a minimal/legacy DB this returns null
// and the context builder falls back to its inline partial list.
function loadArrivalComplementDetail(database, reservationId) {
  try {
    return reservationsModel.create(database).buildArrivalComplementDetail(Number(reservationId));
  } catch {
    return null;
  }
}

function loadReservationGraph(database, reservationId) {
  const id = Number(reservationId);
  const reservation = database.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  if (!reservation) return null;
  const client = reservation.clientId
    ? database.prepare('SELECT * FROM clients WHERE id = ?').get(reservation.clientId)
    : null;
  const property = reservation.propertyId
    ? database.prepare('SELECT * FROM properties WHERE id = ?').get(reservation.propertyId)
    : null;
  // Joined options — surface `title` (+ `titleEn` for English emails) + `autoOptionType`.
  const options = database.prepare(`
    SELECT ro.*, o.title, o.titleEn, o.autoOptionType, o.displayToClient
    FROM reservation_options ro
    JOIN options o ON o.id = ro.optionId
    WHERE ro.reservationId = ?
  `).all(id);
  // Joined resources — surface `name` (+ `nameEn` for English emails) for the resources list.
  const resources = database.prepare(`
    SELECT rr.*, res.name, res.nameEn
    FROM reservation_resources rr
    JOIN resources res ON res.id = rr.resourceId
    WHERE rr.reservationId = ?
  `).all(id);
  // Custom (free-text) options — needed for the J-1 complement breakdown
  // (specs/j1-complement-to-collect.md §3). `description` is the label, `amount` the value.
  const customOptions = database.prepare(`
    SELECT * FROM reservation_custom_options WHERE reservationId = ?
  `).all(id);
  // Does the reservation's PROPERTY provide bed linen by default? (specs/j1-linen-default-message.md
  // §3 rule 1) — the bed-linen option is a default-offered option for that property.
  const bedLinenProvidedByDefault = reservation.propertyId
    ? Boolean(database.prepare(`
        SELECT 1 FROM property_option_defaults d
        JOIN options o ON o.id = d.optionId
        WHERE d.propertyId = ? AND o.autoOptionType = 'bed_linen' AND d.offered = 1
        LIMIT 1
      `).get(reservation.propertyId))
    : false;
  const arrivalComplementDetail = loadArrivalComplementDetail(database, id);
  const stayFacts = loadStayFacts(database, reservation);
  return { reservation, client, property, options, resources, customOptions, bedLinenProvidedByDefault, arrivalComplementDetail, stayFacts };
}

module.exports = { loadReservationGraph, loadArrivalComplementDetail };
