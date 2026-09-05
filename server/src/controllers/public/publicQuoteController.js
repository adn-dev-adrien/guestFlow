/**
 * Public quote controller (specs/public-api.md). Computes a quote through the EXISTING pricing
 * engine (calculateReservationQuote) — never reimplements pricing. Sanitizes input, forbids all
 * price-override fields, forces platform='direct', and returns the public quote projection plus an
 * `available` flag derived from consolidated availability.
 */

const db = require('../../database');
const {
  calculateReservationQuote, computePercentOfStayAmount, getTypeMultiplier, roundMoney,
} = require('../../utils/pricing');
const { getTodayIsoDate } = require('../../utils/reservationHelpers');
const optionsModel = require('../../models/optionsModel');
const resourcesModel = require('../../models/resourcesModel');
const { validateStayInput } = require('../../utils/publicInputValidation');
const { toPublicQuote, toPublicCancellationInsurance } = require('../../utils/publicProjections');
const { computeBlockedDates, rangeHasBlockedNight } = require('./publicCatalogController');
const { resolvePublicPaymentMode } = require('../../utils/publicPaymentMode');
const { mergePropertyDefaultsIntoPayload } = require('../../utils/propertyDefaultOptions');
const propertyOptionDefaultsModel = require('../../models/propertyOptionDefaultsModel');
const settingsModel = require('../../models/settingsModel');
const neatSubscriptionsModel = require('../../models/neatSubscriptionsModel');
const { resolveInsurancePricing, buildQuoteSnapshot, isNeatPricingActive } = require('../../utils/neatGuestPricing');
const { buildNeatClient } = require('../../utils/neatClient');
const { ok, fail } = require('./publicHttp');

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
    // the operator fixes the slots later (specs/public-planning-options.md).
    planningCardAsQuantity: true,
    // Neat-derived insurance price (see resolveNeatPricing) — absent on the first run.
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
function buildCancellationInsurance(input, engineQuote, neatPricing) {
  const neatActive = isNeatPricingActive(settingsModel);
  const option = optionsModel.getCancellationInsurance(Number(input.propertyId), { neatPricingActive: neatActive });
  if (!option) return null;
  const optionId = Number(option.id);
  const selected = (input.options || []).some((o) => Number(o.optionId) === optionId);
  // Already priced by the engine when selected — reuse that exact line rather than re-deriving it.
  const line = (engineQuote.optionLines || []).find((l) => Number(l.optionId) === optionId);
  const amount = line
    ? Number(line.totalPrice || 0)
    : (neatPricing
      ? Number(neatPricing.unitPrice)
      : (String(option.priceType) === 'percent_of_stay'
        ? computePercentOfStayAmount(option.price, engineQuote.cancellationInsuranceBase)
        : roundMoney(Number(option.price || 0)
          * getTypeMultiplier(option.priceType, Number(engineQuote.persons || 0), Number(engineQuote.nights || 0)))));
  return toPublicCancellationInsurance(option, { amount, selected, neatPricingActive: neatActive });
}

// Neat-derived guest price for this stay (spec neat-cancellation-insurance-subscription rule 13):
// resolved AFTER a first engine run (the snapshot needs the engine's amounts), null when the
// feature is inactive, the property has no insurance, or Neat + cache are both silent — the
// engine then prices the flagged option from its static tariff exactly as before.
async function resolveNeatPricing(input, engineQuote) {
  const option = optionsModel.getCancellationInsurance(Number(input.propertyId), {
    neatPricingActive: isNeatPricingActive(settingsModel),
  });
  if (!option) return null;
  const optionId = Number(option.id);
  const line = (engineQuote.optionLines || []).find((l) => Number(l.optionId) === optionId);
  const property = db.prepare('SELECT name FROM properties WHERE id = ?').get(Number(input.propertyId));
  const snapshot = buildQuoteSnapshot({
    startDate: input.startDate,
    endDate: input.endDate,
    engineQuote,
    insuranceLineTotal: line ? Number(line.totalPrice || 0) : 0,
    propertyName: property ? String(property.name || '') : '',
  });
  return resolveInsurancePricing(
    { settingsModel, cacheModel: neatSubscriptionsModel, buildClient: buildNeatClient },
    snapshot,
  );
}

async function quote(req, res) {
  const v = validateStayInput(req.body);
  if (!v.ok) return fail(res, 422, 'VALIDATION_FAILED', 'Données de devis invalides.', v.errors);

  const optErrors = checkOptionApplicability(v.value.propertyId, v.value.options);
  if (optErrors) return fail(res, 422, 'VALIDATION_FAILED', 'Option non disponible pour ce logement.', optErrors);

  const resErrors = checkResourceApplicability(v.value.propertyId, v.value.resources);
  if (resErrors) return fail(res, 422, 'VALIDATION_FAILED', 'Ressource non disponible pour ce logement.', resErrors);

  let engineQuote = buildEngineQuote(v.value);
  if (engineQuote.error) {
    if (engineQuote.status === 404) return fail(res, 404, 'PROPERTY_NOT_FOUND', 'Logement introuvable.');
    return fail(res, 422, 'VALIDATION_FAILED', engineQuote.error);
  }

  // Neat-derived insurance price (rule 13): re-run the engine with the resolved override so a
  // selected insurance line is billed at premium + margin. The double run is cheap (pure, sync)
  // and keeps the engine the single pricing authority.
  const neatPricing = await resolveNeatPricing(v.value, engineQuote);
  if (neatPricing) {
    engineQuote = buildEngineQuote({ ...v.value, cancellationInsurancePriceOverride: neatPricing.unitPrice });
  }

  const blocked = computeBlockedDates(v.value.propertyId, v.value.startDate, v.value.endDate);
  const available = !rangeHasBlockedNight(v.value.startDate, v.value.endDate, blocked);

  // Server-decided payment mode: deposit only when the property opted in AND the deposit is positive.
  const paymentMode = resolvePublicPaymentMode(db, v.value.propertyId, Math.round(Number(engineQuote.depositAmount || 0) * 100));

  return ok(res, toPublicQuote(engineQuote, {
    available, startDate: v.value.startDate, endDate: v.value.endDate, paymentMode,
    cancellationInsurance: buildCancellationInsurance(v.value, engineQuote, neatPricing),
  }));
}

module.exports = { quote, buildEngineQuote, checkOptionApplicability, checkResourceApplicability };
