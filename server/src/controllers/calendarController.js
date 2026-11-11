/**
 * Calendar controller — validates the range and the logement of `GET /api/calendar`, then serves the
 * shared read of both calendars (specs/calendar-property-parity.md rule 1).
 */
const calendarModel = require('../models/calendarModel');
const { isReceptionOnly } = require('../constants/roles');
const { toReceptionReservationView } = require('../utils/receptionView');

const MAX_RANGE_DAYS = 400;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value) {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function daysBetween(from, to) {
  return Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000);
}

/** Returns `{ error }` for a refused query, else `{ from, to, propertyId }`. */
function parseQuery(query, model = calendarModel) {
  const from = String(query.from || '');
  const to = String(query.to || '');
  if (!isRealDate(from) || !isRealDate(to)) return { error: 'Les dates doivent être au format AAAA-MM-JJ.' };
  if (from > to) return { error: 'La date de début doit précéder la date de fin.' };
  if (daysBetween(from, to) > MAX_RANGE_DAYS) return { error: `La période ne peut pas dépasser ${MAX_RANGE_DAYS} jours.` };
  let propertyId = null;
  if (query.propertyId != null && query.propertyId !== '') {
    propertyId = Number(query.propertyId);
    if (!Number.isInteger(propertyId) || propertyId <= 0 || !model.propertyExists(propertyId)) return { error: 'Logement inconnu.' };
  }
  return { from, to, propertyId };
}

function range(req, res) {
  const parsed = parseQuery(req.query);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const payload = calendarModel.listRange(parsed);
  if (!isReceptionOnly(req.user)) return res.json(payload);
  // Same finance-free whitelist as GET /reservations, with the bar's own shaped fields kept.
  const stays = payload.stays.map((stay) => ({
    ...toReceptionReservationView(stay),
    label: stay.label,
    platformDisplay: stay.platformDisplay,
    color: stay.color,
    textColor: stay.textColor,
    past: stay.past,
  }));
  return res.json({ ...payload, stays });
}

module.exports = { range, parseQuery };
