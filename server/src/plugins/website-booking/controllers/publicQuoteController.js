/**
 * Public quote controller (specs/public-api.md). Computes a quote through the EXISTING pricing
 * engine (calculateReservationQuote) — never reimplements pricing. Sanitizes input, forbids all
 * price-override fields, forces platform='direct', and returns the public quote projection plus an
 * `available` flag derived from consolidated availability.
 */

const sdk = require('../../sdk');

const db = sdk.coreModule('database');
const {
  calculateReservationQuote, computePercentOfStayAmount, getTypeMultiplier, roundMoney,
} = sdk.coreModule('pricing');
const { getTodayIsoDate } = sdk.coreModule('reservationHelpers');
const optionsModel = sdk.coreModule('optionsModel');
const resourcesModel = sdk.coreModule('resourcesModel');
const { hideUnoffered } = sdk.coreModule('resourceOffer');
const { isBabyBedResource } = sdk.coreModule('babyBedResource');
const { checkGuestCapacity, publicGuestCap } = sdk.coreModule('capacity');
const { validateStayInput } = require('../publicInputValidation');
const {
  toPublicQuote, toPublicCancellationInsurance, toPublicOptionLimits, hasUnpricedNights,
} = require('../publicProjections');
const { computeBlockedDates, rangeHasBlockedNight } = require('./publicCatalogController');
const { publicSelectableOptions } = require('../publicSelectableOptions');
const { resolvePublicPaymentMode } = sdk.coreModule('publicPaymentMode');
const { mergePropertyDefaultsIntoPayload } = sdk.coreModule('propertyDefaultOptions');
const propertyOptionDefaultsModel = sdk.coreModule('propertyOptionDefaultsModel');
const paymentProviders = sdk.coreModule('paymentProviders');
const quotePostProcessors = sdk.coreModule('quotePostProcessors');
const { ok, failT, langOf } = sdk.coreModule('publicHttp');
const translationResolver = sdk.coreModule('translationResolver');
const { isPerPersonCardOption } = sdk.coreModule('mealPortions');

// The website's quote — the engine on the direct channel with the property's default options — lives
// in the core, shared with the Google Vacation Rentals feed (specs/google-vacation-rentals-feed.md
// rule 4). Bound here to the modules this plugin reaches through the SDK.
const { buildEngineQuote } = sdk.coreModule('directQuote').createDirectQuote({
  db,
  calculateReservationQuote,
  getTodayIsoDate: () => getTodayIsoDate(),
  optionsModel,
  propertyOptionDefaultsModel,
  mergePropertyDefaultsIntoPayload,
  isPerPersonCardOption,
});

/**
 * Reject any option id the public catalogue does not offer for the property — not applicable, an
 * offered default, internal-only or negative-priced. Returns an error list or null.
 */
function checkOptionApplicability(propertyId, options) {
  if (!options.length) return null;
  const applicable = new Set(publicSelectableOptions(propertyId, { db, optionsModel }).map((o) => Number(o.id)));
  const errors = options
    .filter((o) => !applicable.has(Number(o.optionId)))
    .map((o) => ({ field: 'options', issue: `option ${o.optionId} is not available for this property` }));
  return errors.length ? errors : null;
}

/**
 * Reject any resource id that is not applicable to the property. Returns an error list or null.
 *
 * The cot is never a line here (fixed at the 2026-10-27 spec review): it is couchage, driven by
 * `babyBeds` and capped at the number of babies (public-api rule 8); ordered as a resource it bypassed
 * that cap.
 */
function checkResourceApplicability(propertyId, resources) {
  if (!resources || !resources.length) return null;
  // Phase 3c rule 18 — a resource sold by the hour is not on sale while no plugin offers it.
  const applicable = new Set(hideUnoffered(resourcesModel.list(propertyId))
    .filter((r) => !isBabyBedResource(r))
    .map((r) => Number(r.id)));
  const errors = resources
    .filter((r) => !applicable.has(Number(r.resourceId)))
    .map((r) => ({ field: 'resources', issue: `resource ${r.resourceId} is not available for this property` }));
  return errors.length ? errors : null;
}

/**
 * The cancellation-insurance block of the quote (specs/cancellation-insurance.md §3.3 rule 19).
 *
 * Priced for THIS stay whether or not the visitor selected it, so the site shows the real amount
 * beside the Oui/Non choice. The amount comes from the very same engine helper + assiette
 * (`cancellationInsuranceBase`) that prices the billed line, so the preview and the invoice cannot
 * diverge. A fixed-price insurance (`per_stay`, `per_person`…) is priced through the engine's own
 * multipliers instead.
 */
function buildCancellationInsurance(input, engineQuote, insurancePrice, { lang = 'fr', translate = null } = {}) {
  const dynamicPrice = quotePostProcessors.dynamicInsurance();
  const option = optionsModel.getCancellationInsurance(Number(input.propertyId), { dynamicPrice });
  if (!option) return null;
  const optionId = Number(option.id);
  const selected = (input.options || []).some((o) => Number(o.optionId) === optionId);
  // Already priced by the engine when selected — reuse that exact line rather than re-deriving it.
  const line = (engineQuote.optionLines || []).find((l) => Number(l.optionId) === optionId);
  const amount = line
    ? Number(line.totalPrice || 0)
    : (insurancePrice !== null
      ? Number(insurancePrice)
      : (String(option.priceType) === 'percent_of_stay'
        ? computePercentOfStayAmount(option.price, engineQuote.cancellationInsuranceBase)
        : roundMoney(Number(option.price || 0)
          * getTypeMultiplier(option.priceType, Number(engineQuote.persons || 0), Number(engineQuote.nights || 0)))));
  return toPublicCancellationInsurance(option, {
    amount, selected, dynamicPrice, lang, translate,
  });
}

/**
 * The portion caps this stay imposes (specs/site-meal-portions.md rule 7). The engine does not echo
 * the times it was given, so they come from the validated input, falling back to the property's own
 * default check-in / check-out — exactly what the engine itself used.
 */
function buildOptionLimits(input, engineQuote, lang = 'fr') {
  return toPublicOptionLimits({
    lang,
    options: optionsModel.listForProperty(Number(input.propertyId)),
    persons: Number(engineQuote.persons || 0),
    nights: Number(engineQuote.nights || 0),
    checkInTime: input.checkInTime,
    checkOutTime: input.checkOutTime,
    property: {
      defaultCheckIn: engineQuote.defaultCheckIn,
      defaultCheckOut: engineQuote.defaultCheckOut,
    },
  });
}

async function quote(req, res) {
  const lang = langOf(req);
  // One resolver for the whole quote: the lines, the insurance block and the portion hints all name
  // labels, and one catalogue read serves them all (specs/translation-catalogue.md rule 21).
  const translate = translationResolver.forLang(lang);
  const v = validateStayInput(req.body, { todayIso: sdk.coreModule('reservationHelpers').getTodayIsoDate() });
  if (!v.ok) return failT(res, req, 422, 'VALIDATION_FAILED', 'devisInvalid', v.errors);

  const optErrors = checkOptionApplicability(v.value.propertyId, v.value.options);
  if (optErrors) return failT(res, req, 422, 'VALIDATION_FAILED', 'optionUnavailable', optErrors);

  const resErrors = checkResourceApplicability(v.value.propertyId, v.value.resources);
  if (resErrors) return failT(res, req, 422, 'VALIDATION_FAILED', 'resourceUnavailable', resErrors);

  let engineQuote = buildEngineQuote(v.value);
  if (engineQuote.error) {
    if (engineQuote.status === 404) return failT(res, req, 404, 'PROPERTY_NOT_FOUND', 'propertyNotFound');
    return failT(res, req, 422, 'VALIDATION_FAILED', 'quoteRefused', [{ field: 'quote', issue: engineQuote.error }]);
  }

  // Public-api rule 8 — the party within the property's capacity, checked like the booking request
  // checks it, on the property row the engine read (fixed at the 2026-10-27 spec review: a party over
  // capacity was quoted `available: true`).
  const property = engineQuote.property || {};
  if (checkGuestCapacity({ ...property, maxGuests: publicGuestCap(property) }, v.value)) {
    return failT(res, req, 409, 'OVER_CAPACITY', 'overCapacity');
  }

  // The insurance price a plugin sets for this stay (specs/plugins-phase-3b-neat.md rule 2), priced
  // whether or not the visitor ticked it: the engine re-runs with it, so a selected line is billed at
  // that price and the engine stays the single pricing authority.
  const insurancePrice = await quotePostProcessors.livePrice({ engineInput: { db, ...v.value }, quote: engineQuote });
  if (insurancePrice !== null) {
    engineQuote = buildEngineQuote({ ...v.value, cancellationInsurancePriceOverride: insurancePrice });
  }

  const blocked = computeBlockedDates(v.value.propertyId, v.value.startDate, v.value.endDate);
  // A night no season prices is not for sale (specs/booking-drawer-friction.md rule 10), whatever the
  // engine's fallback rate would make of it (`unpricedNights`, fixed at the 2026-10-27 audit).
  const available = !rangeHasBlockedNight(v.value.startDate, v.value.endDate, blocked)
    && !hasUnpricedNights(engineQuote);

  // Server-decided payment mode: deposit only when the property opted in AND the deposit is positive.
  const paymentMode = resolvePublicPaymentMode(db, v.value.propertyId, Math.round(Number(engineQuote.depositAmount || 0) * 100));

  return ok(res, toPublicQuote(engineQuote, {
    available, startDate: v.value.startDate, endDate: v.value.endDate, paymentMode,
    onlinePaymentReady: Boolean(paymentProviders.active()),
    cancellationInsurance: buildCancellationInsurance(v.value, engineQuote, insurancePrice, { lang, translate }),
    optionLimits: buildOptionLimits(v.value, engineQuote, lang),
    lang,
    translate,
  }));
}

module.exports = {
  quote, buildEngineQuote, buildOptionLimits, checkOptionApplicability, checkResourceApplicability,
};
