/**
 * Public quote controller (specs/public-api.md). Computes a quote through the EXISTING pricing
 * engine (calculateReservationQuote) — never reimplements pricing. Sanitizes input, forbids all
 * price-override fields, forces platform='direct', and returns the public quote projection plus an
 * `available` flag derived from consolidated availability.
 */

const db = require('../../database');
const { calculateReservationQuote } = require('../../utils/pricing');
const optionsModel = require('../../models/optionsModel');
const { validateStayInput } = require('../../utils/publicInputValidation');
const { toPublicQuote } = require('../../utils/publicProjections');
const { computeBlockedDates, rangeHasBlockedNight } = require('./publicCatalogController');
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

function buildEngineQuote(input) {
  return calculateReservationQuote({
    db,
    propertyId: input.propertyId,
    startDate: input.startDate,
    endDate: input.endDate,
    checkInTime: input.checkInTime,
    checkOutTime: input.checkOutTime,
    adults: input.adults,
    children: input.children,
    teens: input.teens,
    babies: input.babies,
    selectedOptions: input.options.map((o) => ({ optionId: o.optionId, quantity: o.quantity })),
    platform: 'direct',
  });
}

function quote(req, res) {
  const v = validateStayInput(req.body);
  if (!v.ok) return fail(res, 422, 'VALIDATION_FAILED', 'Données de devis invalides.', v.errors);

  const optErrors = checkOptionApplicability(v.value.propertyId, v.value.options);
  if (optErrors) return fail(res, 422, 'VALIDATION_FAILED', 'Option non disponible pour ce logement.', optErrors);

  const engineQuote = buildEngineQuote(v.value);
  if (engineQuote.error) {
    if (engineQuote.status === 404) return fail(res, 404, 'PROPERTY_NOT_FOUND', 'Logement introuvable.');
    return fail(res, 422, 'VALIDATION_FAILED', engineQuote.error);
  }

  const blocked = computeBlockedDates(v.value.propertyId, v.value.startDate, v.value.endDate);
  const available = !rangeHasBlockedNight(v.value.startDate, v.value.endDate, blocked);

  return ok(res, toPublicQuote(engineQuote, {
    available, startDate: v.value.startDate, endDate: v.value.endDate,
  }));
}

module.exports = { quote, buildEngineQuote, checkOptionApplicability };
