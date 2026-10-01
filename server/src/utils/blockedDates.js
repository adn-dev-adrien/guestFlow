/**
 * The nights a property cannot be booked over [from, to): reservations (iCal platform blocks are
 * stored as reservation rows) and establishment closures. Source-agnostic on purpose: a public caller
 * never learns WHY a date is blocked.
 *
 * Core, because the public quote and booking request (website-booking) and the public payment of
 * online-payment both re-check availability (specs/plugins-phase-2-hosts.md rule 23).
 */

const reservationsModel = require('../models/reservationsModel');
const establishmentClosuresModel = require('../models/establishmentClosuresModel');
const { buildOccupiedDatesFromReservations } = require('./occupancy');

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

module.exports = { computeBlockedDates, rangeHasBlockedNight };
