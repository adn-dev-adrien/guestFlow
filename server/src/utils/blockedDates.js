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
const { buildOccupiedDatesFromReservations, addIsoDays, rangeHasBlockedNight } = require('./occupancy');

function computeBlockedDates(propertyId, from, to) {
  // A neighbour's late check-out blocks the night of its departure day, an early check-in the night
  // before its arrival: both reach one night past their own dates. The reservations are therefore read
  // one day wider on each side, and what they block is kept inside [from, to) only (fixed at the
  // 2026-10-27 audit: an exact-window re-check of a stay starting on such a departure day missed it).
  const reservations = reservationsModel.getOccupiedReservations(Number(propertyId), addIsoDays(from, -1), addIsoDays(to, 1));
  const occupied = buildOccupiedDatesFromReservations(reservations).filter((d) => d >= from && d < to);
  const closures = establishmentClosuresModel.list({ propertyId: Number(propertyId), from, to });
  const closureDates = establishmentClosuresModel.expandClosuresToDates(closures);
  return Array.from(new Set([...occupied, ...closureDates])).sort();
}

module.exports = { computeBlockedDates, rangeHasBlockedNight };
