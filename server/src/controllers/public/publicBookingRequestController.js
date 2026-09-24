/**
 * Public booking-request controller (specs/public-api.md). The only public write. Creates a
 * PENDING record — a draft devis flagged requestOrigin='public' — never a confirmed reservation.
 *
 * Flow: validate → honeypot → option applicability → property/capacity → server-side availability +
 * min-nights re-check (via the pricing engine) → resolve-or-create client by email → create the
 * draft devis (reuses devisModel, which reruns the engine for the persisted pricing) → mark origin.
 *
 * CGV (specs/terms-acceptance-record.md §3.4): the request must carry the CURRENT published version the
 * guest ticked; the acceptance is written in the same transaction as the client and the devis, with the
 * server clock and the visitor the proxy relayed (req.visitor, middleware/visitorContext.js).
 */

const db = require('../../database');
const clientsModel = require('../../models/clientsModel');
const devisModel = require('../../models/devisModel');
const notificationService = require('../../utils/notificationService');
const settingsModel = require('../../models/settingsModel');
const termsModel = require('../../models/termsModel');
const { validateStayInput, validateGuest } = require('../../utils/publicInputValidation');
const { checkGuestCapacity } = require('../../utils/capacity');
const { generateToken } = require('../../utils/publicDevisToken');
const { computeBlockedDates, rangeHasBlockedNight } = require('./publicCatalogController');
const { buildEngineQuote, checkOptionApplicability, checkResourceApplicability } = require('./publicQuoteController');
const optionsModel = require('../../models/optionsModel');
const { isPerPersonCardOption, portionCap, portionWording } = require('../../utils/mealPortions');
const { ok, fail, failT, langOf } = require('./publicHttp');

/**
 * Per-person card options asked for beyond `persons × servings` (specs/site-meal-portions.md rule 3).
 * Returns the refusal, written in the visitor's language, + the usual `details` shape, or null when
 * everything fits.
 */
function checkPortionCaps(input, engineQuote, lang = 'fr') {
  const asked = new Map((input.options || []).map((o) => [Number(o.optionId), Number(o.quantity || 0)]));
  if (!asked.size) return null;
  const options = optionsModel.listForProperty(Number(input.propertyId)).filter(isPerPersonCardOption);
  for (const option of options) {
    const quantity = asked.get(Number(option.id));
    if (!(quantity > 0)) continue;
    const limit = portionCap({
      option,
      persons: Number(engineQuote.persons || 0),
      nights: Number(engineQuote.nights || 0),
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      property: { defaultCheckIn: engineQuote.defaultCheckIn, defaultCheckOut: engineQuote.defaultCheckOut },
    });
    if (quantity > limit.cap) {
      return {
        message: portionWording(option, lang).refusal({ ...limit, nights: Number(engineQuote.nights || 0) }),
        details: [{ field: 'options', issue: `option ${option.id} quantity ${quantity} exceeds ${limit.cap}` }],
      };
    }
  }
  return null;
}

function create(req, res) {
  // Honeypot: a filled `_hp` means a bot. Respond like a success WITHOUT persisting anything, so a
  // spammer can't tell a block from a pass (specs/public-api.md §3 edge cases).
  if (String(req.body._hp || '').trim() !== '') {
    return ok(res, { status: 'pending' }, 201);
  }

  const v = validateStayInput(req.body);
  if (!v.ok) return failT(res, req, 422, 'VALIDATION_FAILED', 'requestInvalid', v.errors);

  const g = validateGuest(req.body.guest);
  if (!g.ok) return failT(res, req, 422, 'VALIDATION_FAILED', 'clientInvalid', g.errors);

  const terms = checkTermsAcceptance(req.body.termsVersion);
  if (terms.error) return fail(res, terms.status, terms.code, terms.message, terms.details);

  const optErrors = checkOptionApplicability(v.value.propertyId, v.value.options);
  if (optErrors) return failT(res, req, 422, 'VALIDATION_FAILED', 'optionUnavailable', optErrors);

  const resErrors = checkResourceApplicability(v.value.propertyId, v.value.resources);
  if (resErrors) return failT(res, req, 422, 'VALIDATION_FAILED', 'resourceUnavailable', resErrors);

  const property = db.prepare('SELECT maxGuests, maxBabies FROM properties WHERE id = ?').get(v.value.propertyId);
  if (!property) return failT(res, req, 404, 'PROPERTY_NOT_FOUND', 'propertyNotFound');

  // Same rule as the back-office (utils/capacity.js), but with NO force override on the public path.
  if (checkGuestCapacity(property, v.value)) {
    return failT(res, req, 409, 'OVER_CAPACITY', 'overCapacity');
  }

  // Server-side availability re-check (the proxy's quote may be stale).
  const blocked = computeBlockedDates(v.value.propertyId, v.value.startDate, v.value.endDate);
  if (rangeHasBlockedNight(v.value.startDate, v.value.endDate, blocked)) {
    return failT(res, req, 409, 'DATES_UNAVAILABLE', 'datesUnavailable');
  }

  // Run the engine to enforce min-nights and to surface the price for the receipt.
  const engineQuote = buildEngineQuote(v.value);
  if (engineQuote.error) {
    if (engineQuote.status === 404) return failT(res, req, 404, 'PROPERTY_NOT_FOUND', 'propertyNotFound');
    // The engine writes for the back-office, in French. The visitor reads our sentence; the
    // engine's own wording travels in `details`, where a diagnostic belongs.
    return failT(res, req, 422, 'VALIDATION_FAILED', 'quoteRefused', [{ field: 'quote', issue: engineQuote.error }]);
  }
  if (engineQuote.minNightsBreached) {
    return failT(res, req, 409, 'MIN_NIGHTS', 'minNights', undefined, engineQuote.requiredMinNights);
  }

  // Portions over what the stay can serve are REFUSED here, where the live quote only clamps
  // (specs/site-meal-portions.md rule 3): this request becomes the devis the guest pays, so it is
  // never quietly altered.
  const portionError = checkPortionCaps(v.value, engineQuote, langOf(req));
  if (portionError) {
    return fail(res, 422, 'VALIDATION_FAILED', portionError.message, portionError.details);
  }

  const visitor = req.visitor || {};
  const persist = db.transaction(() => {
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
      // Public/site devis: planning-card options are billed by quantity + left unscheduled for the
      // operator to arrange (specs/public-planning-options.md); a per-person one counts portions,
      // already checked against the stay's cap above (specs/site-meal-portions.md).
      planningCardAsQuantity: true,
      notes: String(req.body.message || '').trim(),
    });
    // Throwing rolls the client creation back with it; the error is answered below.
    if (result.error) throw Object.assign(new Error(result.error), { devisError: result });

    const devis = result.data;
    // Mark the row as a public-origin request so the admin can filter/badge it, and mint the per-devis
    // capability token that authorises the public /pay + /status routes (specs/public-online-payment.md
    // §7).
    const publicToken = generateToken();
    db.prepare("UPDATE reservations SET requestOrigin = 'public', publicToken = ? WHERE id = ?").run(publicToken, devis.id);

    if (terms.version) {
      termsModel.insertAcceptance({
        reservationId: devis.id,
        termsVersionId: terms.version.id,
        version: terms.version.version,
        acceptedAt: new Date().toISOString(),
        ip: visitor.ip,
        userAgent: visitor.userAgent,
        pluginVersion: visitor.pluginVersion,
      });
    }
    return { devis, publicToken };
  });

  let persisted;
  try {
    persisted = persist();
  } catch (e) {
    if (e.devisError) {
      // Same reasoning as the engine above: the model's French wording is a diagnostic.
      return failT(res, req, e.devisError.status || 400, 'BOOKING_REQUEST_FAILED', 'quoteRefused',
        [{ field: 'devis', issue: String(e.devisError.error || '') }]);
    }
    throw e;
  }
  const { devis, publicToken } = persisted;
  if (visitor.pluginVersion) settingsModel.upsert({ lastSeenPluginVersion: visitor.pluginVersion });

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

/**
 * Rules 13, 15-17. `version` is the current published version when the guest accepted it, null when
 * the emergency switch is off and nothing (valid) was sent.
 */
function checkTermsAcceptance(termsVersion) {
  const { requireTermsAcceptance } = settingsModel.termsSettings();
  const current = termsModel.getCurrent();
  const sent = termsVersion === undefined || termsVersion === null || termsVersion === '' ? null : Number(termsVersion);
  if (requireTermsAcceptance) {
    if (!current) {
      return { error: true, status: 503, code: 'TERMS_NOT_CONFIGURED', message: 'Les réservations en ligne sont momentanément indisponibles.' };
    }
    if (sent === null) {
      return { error: true, status: 422, code: 'TERMS_NOT_ACCEPTED', message: 'Vous devez accepter les conditions générales de location.' };
    }
  }
  if (sent === null || !current) return { version: null };
  if (sent !== current.version) {
    return {
      error: true,
      status: 409,
      code: 'TERMS_OUTDATED',
      message: 'Les conditions générales ont été mises à jour. Merci de les relire et de les accepter à nouveau.',
      details: [{ field: 'termsVersion', issue: 'outdated', currentVersion: current.version }],
    };
  }
  return { version: current };
}

module.exports = { create, checkTermsAcceptance };
