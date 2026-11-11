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
const { buildOccupiedDatesFromReservations, addIsoDays, rangeHasBlockedNight, getNightBlocksFromTimes } = require('./occupancy');
const database = require('../database');

function computeBlockedDates(propertyId, from, to) {
  // A neighbour's late check-out blocks the night of its departure day, an early check-in the night
  // before its arrival: both reach one night past their own dates. The reservations are therefore read
  // one day wider on each side, and what they block is kept inside [from, to) only (fixed at the
  // 2026-10-27 audit: an exact-window re-check of a stay starting on such a departure day missed it).
  const reservations = reservationsModel.getOccupiedReservations(Number(propertyId), addIsoDays(from, -1), addIsoDays(to, 1));
  const occupied = buildOccupiedDatesFromReservations(reservations).filter((d) => d >= from && d < to);
  const closures = establishmentClosuresModel.list({ propertyId: Number(propertyId), from, to });
  const closureDates = establishmentClosuresModel.expandClosuresToDates(closures, { from, to });
  return Array.from(new Set([...occupied, ...closureDates])).sort();
}

/**
 * Whether the visitor's own arrival and departure times clash with the neighbouring stays or a closure
 * (specs/public-api.md rule 24): the back office's check, run with those times and the nights they take.
 * A time not sent is the property's default, the one the devis will store, not the check's 15:00 / 10:00.
 * Judged after the nights are known free; the past is judged by each caller's own date rules.
 */
function stayTimesRefused({ propertyId, startDate, endDate, checkInTime, checkOutTime }) {
  const property = database.prepare('SELECT defaultCheckIn, defaultCheckOut FROM properties WHERE id = ?').get(Number(propertyId)) || {};
  const checkIn = checkInTime || property.defaultCheckIn || '15:00';
  const checkOut = checkOutTime || property.defaultCheckOut || '10:00';
  return Boolean(reservationsModel.validateAvailability(
    Number(propertyId), startDate, endDate, checkIn, checkOut, null, getNightBlocksFromTimes(checkIn, checkOut), { allowPastDates: true },
  ));
}

module.exports = { computeBlockedDates, rangeHasBlockedNight, stayTimesRefused };
