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

// specs/terms-acceptance-record.md rule 26 — the CGV version `{{cgvUrl}}` points at: the one the guest
// accepted, else the current one, else null. Guarded like the loader above: a minimal/legacy schema
// without the CGV tables simply yields no link.
function loadTermsVersion(database, reservationId) {
  try {
    const accepted = database.prepare(`
      SELECT v.version FROM terms_acceptances a JOIN terms_versions v ON v.id = a.termsVersionId
       WHERE a.reservationId = ? ORDER BY a.id DESC LIMIT 1
    `).get(Number(reservationId));
    if (accepted) return accepted.version;
    const current = database.prepare('SELECT MAX(version) AS v FROM terms_versions').get();
    return current && current.v ? current.v : null;
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
  // Joined options / resources. The English name no longer lives on the row: it comes from the
  // translation catalogue (specs/translation-catalogue.md rule 2), read once for the whole graph
  // rather than once per line. `titleEn` / `nameEn` keep their names here because that is what the
  // context builder reads, and they keep their meaning: NULL when there is no translation, so the
  // builder's French fallback still decides.
  const options = database.prepare(`
    SELECT ro.*, o.title, o.autoOptionType, o.displayToClient
    FROM reservation_options ro
    JOIN options o ON o.id = ro.optionId
    WHERE ro.reservationId = ?
  `).all(id);
  const resources = database.prepare(`
    SELECT rr.*, res.name
    FROM reservation_resources rr
    JOIN resources res ON res.id = rr.resourceId
    WHERE rr.reservationId = ?
  `).all(id);
  require('./translationResolver').attachEnglishNames(database, { options, resources });
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
  const termsVersion = loadTermsVersion(database, id);
  return { reservation, client, property, options, resources, customOptions, bedLinenProvidedByDefault, arrivalComplementDetail, stayFacts, termsVersion };
}

module.exports = { loadReservationGraph, loadArrivalComplementDetail, loadTermsVersion };
