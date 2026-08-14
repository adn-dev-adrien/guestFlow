/**
 * Public booking-request controller (specs/public-api.md). The only public write. Creates a
 * PENDING record — a draft devis flagged requestOrigin='public' — never a confirmed reservation.
 *
 * Flow: validate → honeypot → option applicability → property/capacity → server-side availability +
 * min-nights re-check (via the pricing engine) → resolve-or-create client by email → create the
 * draft devis (reuses devisModel, which reruns the engine for the persisted pricing) → mark origin.
 */

const db = require('../../database');
const clientsModel = require('../../models/clientsModel');
const devisModel = require('../../models/devisModel');
const notificationService = require('../../utils/notificationService');
const { validateStayInput, validateGuest } = require('../../utils/publicInputValidation');
const { checkGuestCapacity } = require('../../utils/capacity');
const { generateToken } = require('../../utils/publicDevisToken');
const { computeBlockedDates, rangeHasBlockedNight } = require('./publicCatalogController');
const { buildEngineQuote, checkOptionApplicability, checkResourceApplicability } = require('./publicQuoteController');
const { ok, fail } = require('./publicHttp');

function create(req, res) {
  // Honeypot: a filled `_hp` means a bot. Respond like a success WITHOUT persisting anything, so a
  // spammer can't tell a block from a pass (specs/public-api.md §3 edge cases).
  if (String(req.body._hp || '').trim() !== '') {
    return ok(res, { status: 'pending' }, 201);
  }

  const v = validateStayInput(req.body);
  if (!v.ok) return fail(res, 422, 'VALIDATION_FAILED', 'Données de demande invalides.', v.errors);

  const g = validateGuest(req.body.guest);
  if (!g.ok) return fail(res, 422, 'VALIDATION_FAILED', 'Coordonnées du client invalides.', g.errors);

  const optErrors = checkOptionApplicability(v.value.propertyId, v.value.options);
  if (optErrors) return fail(res, 422, 'VALIDATION_FAILED', 'Option non disponible pour ce logement.', optErrors);

  const resErrors = checkResourceApplicability(v.value.propertyId, v.value.resources);
  if (resErrors) return fail(res, 422, 'VALIDATION_FAILED', 'Ressource non disponible pour ce logement.', resErrors);

  const property = db.prepare('SELECT maxGuests, maxBabies FROM properties WHERE id = ?').get(v.value.propertyId);
  if (!property) return fail(res, 404, 'PROPERTY_NOT_FOUND', 'Logement introuvable.');

  // Same rule as the back-office (utils/capacity.js), but with NO force override on the public path.
  if (checkGuestCapacity(property, v.value)) {
    return fail(res, 409, 'OVER_CAPACITY', 'Le nombre de personnes dépasse la capacité du logement.');
  }

  // Server-side availability re-check (the proxy's quote may be stale).
  const blocked = computeBlockedDates(v.value.propertyId, v.value.startDate, v.value.endDate);
  if (rangeHasBlockedNight(v.value.startDate, v.value.endDate, blocked)) {
    return fail(res, 409, 'DATES_UNAVAILABLE', 'Ces dates ne sont plus disponibles.');
  }

  // Run the engine to enforce min-nights and to surface the price for the receipt.
  const engineQuote = buildEngineQuote(v.value);
  if (engineQuote.error) {
    if (engineQuote.status === 404) return fail(res, 404, 'PROPERTY_NOT_FOUND', 'Logement introuvable.');
    return fail(res, 422, 'VALIDATION_FAILED', engineQuote.error);
  }
  if (engineQuote.minNightsBreached) {
    return fail(res, 409, 'MIN_NIGHTS', `Séjour trop court : minimum ${engineQuote.requiredMinNights} nuit(s).`);
  }

  // Resolve-or-create the client by normalized email (never overwrite an existing name/phone).
  let client = clientsModel.findByEmail(g.value.email);
  if (!client) {
    client = clientsModel.insert({
      firstName: g.value.firstName, lastName: g.value.lastName,
      email: g.value.email, phone: g.value.phone,
    });
  }

  const result = devisModel.create({
    propertyId: v.value.propertyId,
    clientId: client.id,
    startDate: v.value.startDate,
    endDate: v.value.endDate,
    checkInTime: v.value.checkInTime,
    checkOutTime: v.value.checkOutTime,
    adults: v.value.adults,
    children: v.value.children,
    teens: v.value.teens,
    babies: v.value.babies,
    // Baby beds are couchage, not a resource line — persisting them on the devis `babyBeds` field
    // makes them visible in the operator's Couchage section (the "Lit bébé" resource is filtered
    // out of the supplements list). specs/site-booking-notifications.md §3 rule 16.
    babyBeds: v.value.babyBeds,
    selectedOptions: v.value.options.map((o) => ({ optionId: o.optionId, quantity: o.quantity })),
    selectedResources: (v.value.resources || []).map((r) => ({ resourceId: r.resourceId, quantity: r.quantity })),
    platform: 'direct',
    // Public/site devis: planning-card options are billed by quantity + left unscheduled for the operator
    // to arrange (specs/public-planning-options.md).
    planningCardAsQuantity: true,
    notes: String(req.body.message || '').trim(),
  });
  if (result.error) return fail(res, result.status || 400, 'BOOKING_REQUEST_FAILED', result.error);

  const devis = result.data;
  // Mark the row as a public-origin request so the admin can filter/badge it, and mint the per-devis
  // capability token that authorises the public /pay + /status routes (specs/public-online-payment.md
  // §7). Separate write — neither is part of devis create's contract; no atomicity concern for markers.
  const publicToken = generateToken();
  db.prepare("UPDATE reservations SET requestOrigin = 'public', publicToken = ? WHERE id = ?").run(publicToken, devis.id);

  // Best-effort admin notification (specs/site-booking-notifications.md §3 rule 6). Fire-and-forget:
  // the service swallows its own errors, so a failed/disabled/unconfigured email never affects the
  // visitor's 201 response.
  Promise.resolve(notificationService.notifyNewSiteDevis(devis.id)).catch(() => {});

  return ok(res, {
    requestId: devis.id,
    // Capability token the proxy must echo back on /pay + /status for this devis (never guessable).
    publicToken,
    status: 'pending',
    reference: devis.devisNumber || null,
    propertyId: v.value.propertyId,
    startDate: v.value.startDate,
    endDate: v.value.endDate,
    finalPrice: Number(devis.finalPrice || 0),
    currency: 'EUR',
  }, 201);
}

module.exports = { create };
