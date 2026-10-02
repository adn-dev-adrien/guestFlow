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
const { validateStayInput } = require('../publicInputValidation');
const { toPublicQuote, toPublicCancellationInsurance, toPublicOptionLimits } = require('../publicProjections');
const { computeBlockedDates, rangeHasBlockedNight } = require('./publicCatalogController');
const { resolvePublicPaymentMode } = sdk.coreModule('publicPaymentMode');
const { mergePropertyDefaultsIntoPayload } = sdk.coreModule('propertyDefaultOptions');
const propertyOptionDefaultsModel = sdk.coreModule('propertyOptionDefaultsModel');
const quotePostProcessors = sdk.coreModule('quotePostProcessors');
const { ok, failT, langOf } = sdk.coreModule('publicHttp');
const translationResolver = sdk.coreModule('translationResolver');
const { isPerPersonCardOption } = sdk.coreModule('mealPortions');

/** Reject any option id that is not applicable to the property. Returns an error list or null. */
function checkOptionApplicability(propertyId, options) {
  if (!options.length) return null;
  const applicable = new Set(optionsModel.listForProperty(propertyId).map((o) => Number(o.id)));
  const errors = options
    .filter((o) => !applicable.has(Number(o.optionId)))
    .map((o) => ({ field: 'options', issue: `option ${o.optionId} is not available for this property` }));
  return errors.length ? errors : null;
}

/** Reject any resource id that is not applicable to the property. Returns an error list or null. */
function checkResourceApplicability(propertyId, resources) {
  if (!resources || !resources.length) return null;
  const applicable = new Set(resourcesModel.list(propertyId).map((r) => Number(r.id)));
  const errors = resources
    .filter((r) => !applicable.has(Number(r.resourceId)))
    .map((r) => ({ field: 'resources', issue: `resource ${r.resourceId} is not available for this property` }));
  return errors.length ? errors : null;
}

/**
 * The quantity a property DEFAULT takes on the public flow: one portion per guest for a per-person
 * card option (specs/site-meal-portions.md rule 5), 1 for everything else.
 */
function defaultPortionQuantity(input, optionId) {
  const option = optionsModel.listForProperty(Number(input.propertyId))
    .find((o) => Number(o.id) === Number(optionId));
  if (!isPerPersonCardOption(option)) return 1;
  return Math.max(1, Number(input.adults || 1) + Number(input.children || 0) + Number(input.teens || 0));
}

function buildEngineQuote(input) {
  // Apply the property's DEFAULT options (paid → added, offered → free) the SAME way the booking-request
  // devis does, so the live preview matches the price the guest will actually be charged. The offered
  // ids come ONLY from the server-side defaults — never from client input (no price manipulation).
  // Engine-managed auto-options (early/late check, baby-bed supplement) are DERIVED from the stay
  // itself and must never arrive as a client-chosen line: the engine drops its own line when the id
  // is already selected, so honouring the payload would let a visitor set the quantity — and the
  // price — of a supplement they don't get to choose. Same filter as `devisModel.computeQuote`, so
  // the live quote and the devis the request creates agree (specs/baby-bed-supplement.md §3.5 rule 18).
  const engineManagedAutoIds = new Set(
    optionsModel.listForProperty(Number(input.propertyId))
      .filter((o) => o.autoOptionType && Number(o.autoEnabled || 0) === 1)
      .map((o) => Number(o.id)),
  );
  const merged = mergePropertyDefaultsIntoPayload(
    {
      selectedOptions: input.options
        .filter((o) => !engineManagedAutoIds.has(Number(o.optionId)))
        .map((o) => ({ optionId: o.optionId, quantity: o.quantity })),
      offeredOptionIds: [],
    },
    Number(input.propertyId),
    propertyOptionDefaultsModel,
    { quantityFor: (optionId) => defaultPortionQuantity(input, optionId) },
  );
  return calculateReservationQuote({
    db,
    propertyId: input.propertyId,
    // specs/payment-schedule-and-cancellation.md §3.1 — a public quote is a booking happening now:
    // the acompte is due `depositDueDays` from today and the solde is clamped to today at the
    // earliest, so the site shows the deadlines the reservation will actually carry.
    bookingDate: getTodayIsoDate(),
    startDate: input.startDate,
    endDate: input.endDate,
    checkInTime: input.checkInTime,
    checkOutTime: input.checkOutTime,
    adults: input.adults,
    children: input.children,
    teens: input.teens,
    babies: input.babies,
    // specs/baby-bed-supplement.md §3.5 — the site bills the cot like the fiche does. No `bookingId`:
    // a public quote is always a booking that does not exist yet.
    babyBeds: input.babyBeds,
    selectedOptions: merged.selectedOptions,
    offeredOptionIds: merged.offeredOptionIds,
    selectedResources: (input.resources || []).map((r) => ({ resourceId: r.resourceId, quantity: r.quantity })),
    platform: 'direct',
    // Public/site flow: planning-card options are billed by quantity (unschedulable on the site) —
    // the operator fixes the slots later (specs/public-planning-options.md). A per-person one counts
    // portions, capped by what the stay can serve (specs/site-meal-portions.md).
    planningCardAsQuantity: true,
    // The insurance price a plugin sets (specs/plugins-phase-3b-neat.md rule 2) — absent on the first run.
    cancellationInsurancePriceOverride: input.cancellationInsurancePriceOverride,
  });
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
  const v = validateStayInput(req.body);
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

  // The insurance price a plugin sets for this stay (specs/plugins-phase-3b-neat.md rule 2), priced
  // whether or not the visitor ticked it: the engine re-runs with it, so a selected line is billed at
  // that price and the engine stays the single pricing authority.
  const insurancePrice = await quotePostProcessors.livePrice({ engineInput: { db, ...v.value }, quote: engineQuote });
  if (insurancePrice !== null) {
    engineQuote = buildEngineQuote({ ...v.value, cancellationInsurancePriceOverride: insurancePrice });
  }

  const blocked = computeBlockedDates(v.value.propertyId, v.value.startDate, v.value.endDate);
  const available = !rangeHasBlockedNight(v.value.startDate, v.value.endDate, blocked);

  // Server-decided payment mode: deposit only when the property opted in AND the deposit is positive.
  const paymentMode = resolvePublicPaymentMode(db, v.value.propertyId, Math.round(Number(engineQuote.depositAmount || 0) * 100));

  return ok(res, toPublicQuote(engineQuote, {
    available, startDate: v.value.startDate, endDate: v.value.endDate, paymentMode,
    cancellationInsurance: buildCancellationInsurance(v.value, engineQuote, insurancePrice, { lang, translate }),
    optionLimits: buildOptionLimits(v.value, engineQuote, lang),
    lang,
    translate,
  }));
}

module.exports = {
  quote, buildEngineQuote, buildOptionLimits, checkOptionApplicability, checkResourceApplicability,
};
