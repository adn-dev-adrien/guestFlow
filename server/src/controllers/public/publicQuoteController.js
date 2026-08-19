/**
 * Public quote controller (specs/public-api.md). Computes a quote through the EXISTING pricing
 * engine (calculateReservationQuote) — never reimplements pricing. Sanitizes input, forbids all
 * price-override fields, forces platform='direct', and returns the public quote projection plus an
 * `available` flag derived from consolidated availability.
 */

const db = require('../../database');
const { calculateReservationQuote } = require('../../utils/pricing');
const { getTodayIsoDate } = require('../../utils/reservationHelpers');
const optionsModel = require('../../models/optionsModel');
const resourcesModel = require('../../models/resourcesModel');
const { validateStayInput } = require('../../utils/publicInputValidation');
const { toPublicQuote } = require('../../utils/publicProjections');
const { computeBlockedDates, rangeHasBlockedNight } = require('./publicCatalogController');
const { resolvePublicPaymentMode } = require('../../utils/publicPaymentMode');
const { mergePropertyDefaultsIntoPayload } = require('../../utils/propertyDefaultOptions');
const propertyOptionDefaultsModel = require('../../models/propertyOptionDefaultsModel');
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
  const merged = mergePropertyDefaultsIntoPayload(
    {
      selectedOptions: input.options.map((o) => ({ optionId: o.optionId, quantity: o.quantity })),
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
    selectedOptions: merged.selectedOptions,
    offeredOptionIds: merged.offeredOptionIds,
    selectedResources: (input.resources || []).map((r) => ({ resourceId: r.resourceId, quantity: r.quantity })),
    platform: 'direct',
    // Public/site flow: planning-card options are billed by quantity (unschedulable on the site) —
    // the operator fixes the slots later (specs/public-planning-options.md).
    planningCardAsQuantity: true,
  });
}

function quote(req, res) {
  const v = validateStayInput(req.body);
  if (!v.ok) return fail(res, 422, 'VALIDATION_FAILED', 'Données de devis invalides.', v.errors);

  const optErrors = checkOptionApplicability(v.value.propertyId, v.value.options);
  if (optErrors) return fail(res, 422, 'VALIDATION_FAILED', 'Option non disponible pour ce logement.', optErrors);

  const resErrors = checkResourceApplicability(v.value.propertyId, v.value.resources);
  if (resErrors) return fail(res, 422, 'VALIDATION_FAILED', 'Ressource non disponible pour ce logement.', resErrors);

  const engineQuote = buildEngineQuote(v.value);
  if (engineQuote.error) {
    if (engineQuote.status === 404) return fail(res, 404, 'PROPERTY_NOT_FOUND', 'Logement introuvable.');
    return fail(res, 422, 'VALIDATION_FAILED', engineQuote.error);
  }

  const blocked = computeBlockedDates(v.value.propertyId, v.value.startDate, v.value.endDate);
  const available = !rangeHasBlockedNight(v.value.startDate, v.value.endDate, blocked);

  // Server-decided payment mode: deposit only when the property opted in AND the deposit is positive.
  const paymentMode = resolvePublicPaymentMode(db, v.value.propertyId, Math.round(Number(engineQuote.depositAmount || 0) * 100));

  return ok(res, toPublicQuote(engineQuote, {
    available, startDate: v.value.startDate, endDate: v.value.endDate, paymentMode,
  }));
}

module.exports = { quote, buildEngineQuote, checkOptionApplicability, checkResourceApplicability };
