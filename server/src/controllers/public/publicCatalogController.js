/**
 * Public catalog controller (specs/public-api.md) — read-only property list/detail, per-property
 * options, and consolidated availability. Reuses the existing models + occupancy util; applies the
 * public projections so nothing sensitive leaks. No business logic lives here beyond orchestration.
 */

const db = require('../../database');
const propertiesModel = require('../../models/propertiesModel');
const optionsModel = require('../../models/optionsModel');
const resourcesModel = require('../../models/resourcesModel');
const reservationsModel = require('../../models/reservationsModel');
const establishmentClosuresModel = require('../../models/establishmentClosuresModel');
const { buildOccupiedDatesFromReservations } = require('../../utils/occupancy');
const { validateAvailabilityQuery } = require('../../utils/publicInputValidation');
const {
  toPublicProperty, toPublicPropertyDetail, toPublicOption, toPublicResource, toPublicAvailability,
} = require('../../utils/publicProjections');
const { ok, fail } = require('./publicHttp');
const { isClientVisibleOption } = require('../../utils/optionVisibility');
const { groupOptionsByCategory } = require('../../utils/optionGrouping');

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function propertyExists(propertyId) {
  return Boolean(db.prepare('SELECT 1 FROM properties WHERE id = ?').get(Number(propertyId)));
}

/**
 * Consolidated blocked dates for a property over [from, to): reservations (incl. iCal platform
 * blocks, which are stored as reservation rows) + establishment closures. Source-agnostic — the
 * caller never learns WHY a date is blocked. Shared by /quote and /booking-requests.
 */
function computeBlockedDates(propertyId, from, to) {
  const reservations = reservationsModel.getOccupiedReservations(Number(propertyId), from, to);
  const occupied = buildOccupiedDatesFromReservations(reservations);
  const closures = establishmentClosuresModel.list({ propertyId: Number(propertyId), from, to });
  const closureDates = establishmentClosuresModel.expandClosuresToDates(closures);
  return Array.from(new Set([...occupied, ...closureDates])).sort();
}

/** True iff any night in [start, end) is blocked. Pure given the blocked set. */
function rangeHasBlockedNight(start, end, blockedDates) {
  const set = blockedDates instanceof Set ? blockedDates : new Set(blockedDates || []);
  let cursor = start;
  while (cursor && cursor < end) {
    if (set.has(cursor)) return true;
    const next = new Date(`${cursor}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
  }
  return false;
}

function listProperties(req, res) {
  return ok(res, propertiesModel.list().map(toPublicProperty));
}

function getProperty(req, res) {
  // Read-only on purpose: the public API never mutates server state on a GET, so we use the
  // side-effect-free reader instead of getByIdWithDetails (which seeds default timed options).
  const property = propertiesModel.getByIdPublicReadOnly(Number(req.params.id));
  if (!property) return fail(res, 404, 'PROPERTY_NOT_FOUND', 'Logement introuvable.');
  return ok(res, toPublicPropertyDetail(property));
}

/** Public catalog ordering: cheapest first (ties keep the model's order via a stable sort). */
function byPriceAsc(a, b) {
  return Number(a.price || 0) - Number(b.price || 0);
}

/**
 * Option ids that are OFFERED defaults for a property — included in the price, not a client choice,
 * so they must not surface as selectable on the public booking form
 * (specs/property-default-option-applicability.md rule 4). Guarded for schemas without the table.
 */
function offeredDefaultOptionIds(propertyId) {
  try {
    return new Set(
      db.prepare('SELECT optionId FROM property_option_defaults WHERE propertyId = ? AND offered = 1')
        .all(Number(propertyId)).map((row) => Number(row.optionId))
    );
  } catch { return new Set(); }
}

function listOptions(req, res) {
  const propertyId = Number(req.params.id);
  if (!propertyExists(propertyId)) return fail(res, 404, 'PROPERTY_NOT_FOUND', 'Logement introuvable.');
  const excluded = offeredDefaultOptionIds(propertyId);
  const visible = optionsModel.listForProperty(propertyId)
    .filter((opt) => !excluded.has(Number(opt.id)))
    // Internal-only options (specs/laundry-bath-mat.md §3 rule 11) never reach the public catalog.
    // Filtered BEFORE grouping so a category whose options are all internal yields no group at all
    // (specs/option-categories.md §3 rule 14).
    .filter(isClientVisibleOption)
    .map(toPublicOption);
  // Grouped, render-ready payload (specs/option-categories.md §4.4). Cheapest-first ordering is
  // preserved inside each bucket — the widget renders what it receives, in order.
  const { ungrouped, groups } = groupOptionsByCategory(visible);
  return ok(res, {
    ungrouped: ungrouped.slice().sort(byPriceAsc),
    groups: groups.map((g) => ({ category: g.category, options: g.options.slice().sort(byPriceAsc) })),
  });
}

function listResources(req, res) {
  const propertyId = Number(req.params.id);
  if (!propertyExists(propertyId)) return fail(res, 404, 'PROPERTY_NOT_FOUND', 'Logement introuvable.');
  // resourcesModel.list resolves applicability (resource_properties pivot, empty = global) and the
  // EFFECTIVE per-property price (property_resource_prices). Public projection strips stock/slots.
  return ok(res, resourcesModel.list(propertyId).map(toPublicResource).sort(byPriceAsc));
}

function getAvailability(req, res) {
  const propertyId = Number(req.params.id);
  if (!propertyExists(propertyId)) return fail(res, 404, 'PROPERTY_NOT_FOUND', 'Logement introuvable.');
  const v = validateAvailabilityQuery({ from: req.query.from, to: req.query.to, todayIso: todayIso() });
  if (!v.ok) return fail(res, 422, 'VALIDATION_FAILED', 'Paramètres de période invalides.', v.errors);
  const blockedDates = computeBlockedDates(propertyId, v.value.from, v.value.to);
  return ok(res, toPublicAvailability({ propertyId, from: v.value.from, to: v.value.to, blockedDates }));
}

module.exports = {
  listProperties,
  getProperty,
  listOptions,
  listResources,
  getAvailability,
  // shared helpers
  computeBlockedDates,
  rangeHasBlockedNight,
  propertyExists,
};
