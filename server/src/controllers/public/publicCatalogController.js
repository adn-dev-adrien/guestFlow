/**
 * Public catalog controller (specs/public-api.md) — read-only property list/detail, per-property
 * options, and consolidated availability. Reuses the existing models + occupancy util; applies the
 * public projections so nothing sensitive leaks. No business logic lives here beyond orchestration.
 */

const db = require('../../database');
const propertiesModel = require('../../models/propertiesModel');
const optionsModel = require('../../models/optionsModel');
const reservationsModel = require('../../models/reservationsModel');
const establishmentClosuresModel = require('../../models/establishmentClosuresModel');
const { buildOccupiedDatesFromReservations } = require('../../utils/occupancy');
const { validateAvailabilityQuery } = require('../../utils/publicInputValidation');
const {
  toPublicProperty, toPublicPropertyDetail, toPublicOption, toPublicAvailability,
} = require('../../utils/publicProjections');
const { ok, fail } = require('./publicHttp');

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
  const property = propertiesModel.getByIdWithDetails(Number(req.params.id));
  if (!property) return fail(res, 404, 'PROPERTY_NOT_FOUND', 'Logement introuvable.');
  return ok(res, toPublicPropertyDetail(property));
}

function listOptions(req, res) {
  const propertyId = Number(req.params.id);
  if (!propertyExists(propertyId)) return fail(res, 404, 'PROPERTY_NOT_FOUND', 'Logement introuvable.');
  return ok(res, optionsModel.listForProperty(propertyId).map(toPublicOption));
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
  getAvailability,
  // shared helpers
  computeBlockedDates,
  rangeHasBlockedNight,
  propertyExists,
};
