/**
 * Resolver of the stay phase — the only place that asks « has this stay started? »
 * (specs/pricing-components.md §3 rule 44).
 *
 * `phaseForReservation(id, now)` loads the stay's dates and times, fills a missing or unreadable time (`9:00` and
 * `09:00:00` are read as 09:00; `abc` is unreadable) from the property (`defaultCheckIn` / `defaultCheckOut`, read through
 * the SettingsProvider, which answers 15:00 / 10:00 for a lodging it does not know), and hands them to `stayClock.phaseOf`. `now` is
 * injected by the caller. Returns null when the stay does not exist.
 *
 * Factory `create(db)` (a test drives its own schema) + a default bound to the production database, like
 * settingsModel; the default opens the database on first call, not on require.
 */
const { phaseOf } = require('../utils/pricing/stayClock');
const settingsProvider = require('./ports/settingsProvider');

const FALLBACK_CHECK_IN = '15:00';
const FALLBACK_CHECK_OUT = '10:00';

// `9:00` and `09:00:00` read as 09:00; anything else that is not a time of day (`abc`, `24:00`, `9h`) is a time nobody
// entered: the caller falls back to the next source.
function readableTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value == null ? '' : value).trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || (match[3] !== undefined && Number(match[3]) > 59)) return null;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function create(db) {
  function phaseInputsFor(id) {
    const row = db.prepare(
      `SELECT r.propertyId, r.startDate AS arrivalDate, r.endDate AS departureDate, r.checkInTime, r.checkOutTime
         FROM reservations r
        WHERE r.id = ?`,
    ).get(Number(id));
    if (!row) return null;
    const { defaultCheckIn, defaultCheckOut } = settingsProvider.create(db).for('stayClock', { propertyId: row.propertyId });
    return {
      arrivalDate: row.arrivalDate,
      departureDate: row.departureDate,
      checkInTime: readableTime(row.checkInTime) || readableTime(defaultCheckIn) || FALLBACK_CHECK_IN,
      checkOutTime: readableTime(row.checkOutTime) || readableTime(defaultCheckOut) || FALLBACK_CHECK_OUT,
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
