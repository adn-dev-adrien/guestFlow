/**
 * Resolver of the stay phase — the only place that asks « has this stay started? »
 * (specs/pricing-components.md §3 rule 44).
 *
 * `phaseForReservation(id, now)` loads the stay's dates and times, fills a missing time from the property
 * (`defaultCheckIn` / `defaultCheckOut`), then from 15:00 / 10:00, and hands them to `stayClock.phaseOf`. `now` is
 * injected by the caller. Returns null when the stay does not exist.
 *
 * Factory `create(db)` (a test drives its own schema) + a default bound to the production database, like
 * settingsModel; the default opens the database on first call, not on require.
 */
const { phaseOf } = require('../utils/pricing/stayClock');

const FALLBACK_CHECK_IN = '15:00';
const FALLBACK_CHECK_OUT = '10:00';

const blank = (value) => value == null || String(value).trim() === '';

function create(db) {
  function phaseInputsFor(id) {
    const row = db.prepare(
      `SELECT r.startDate AS arrivalDate, r.endDate AS departureDate, r.checkInTime, r.checkOutTime,
              p.defaultCheckIn, p.defaultCheckOut
         FROM reservations r LEFT JOIN properties p ON p.id = r.propertyId
        WHERE r.id = ?`,
    ).get(Number(id));
    if (!row) return null;
    return {
      arrivalDate: row.arrivalDate,
      departureDate: row.departureDate,
      checkInTime: !blank(row.checkInTime) ? row.checkInTime : (!blank(row.defaultCheckIn) ? row.defaultCheckIn : FALLBACK_CHECK_IN),
      checkOutTime: !blank(row.checkOutTime) ? row.checkOutTime : (!blank(row.defaultCheckOut) ? row.defaultCheckOut : FALLBACK_CHECK_OUT),
    };
  }

  function phaseForReservation(id, now) {
    const inputs = phaseInputsFor(id);
    return inputs ? phaseOf(inputs, now) : null;
  }

  return { phaseForReservation, phaseInputsFor };
}

const productionModel = () => create(require('../database'));

module.exports = {
  create,
  phaseForReservation: (id, now) => productionModel().phaseForReservation(id, now),
  phaseInputsFor: (id) => productionModel().phaseInputsFor(id),
};
