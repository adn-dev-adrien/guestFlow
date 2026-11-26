/**
 * Resolver of the stay phase — the only place that asks « has this stay started? »
 * (specs/pricing/pricing-components.md §3 rule 44).
 *
 * `phaseForReservation(id, now)` loads the stay's dates, times and arrival marks (rule 102: a validated arrival starts the stay), fills a missing or unreadable time (`9:00` and
 * `09:00:00` are read as 09:00; `abc` is unreadable) from the property (`defaultCheckIn` / `defaultCheckOut`, read through
 * the SettingsProvider, which answers 15:00 / 10:00 for a lodging it does not know), and hands them to `stayClock.phaseOf`. `now` is
 * injected by the caller. Returns null when the stay does not exist.
 *
 * Factory `create(db)` (a test drives its own schema) + a default bound to the production database, like
 * settingsModel; the default opens the database on first call, not on require.
 */
const {
  phaseOf, readableTime, dayReached, dayPassed, isArrivalValidated,
} = require('../utils/pricing/stayClock');
const settingsProvider = require('./ports/settingsProvider');

const FALLBACK_CHECK_IN = '15:00';
const FALLBACK_CHECK_OUT = '10:00';

// Rule 102 — the arrival marks, on a schema that holds them (a test may drive a minimal one). Read once per database.
const marksOf = new WeakMap();
function markColumns(db) {
  if (!marksOf.has(db)) {
    const columns = new Set(db.prepare('PRAGMA table_info(reservations)').all().map((column) => column.name));
    marksOf.set(db, ['checkInDone', 'arrivalSasDoneAt'].filter((name) => columns.has(name)).map((name) => `, r.${name}`).join(''));
  }
  return marksOf.get(db);
}

function create(db) {
  const marks = markColumns(db);
  function phaseInputsFor(id) {
    const row = db.prepare(
      `SELECT r.propertyId, r.startDate AS arrivalDate, r.endDate AS departureDate, r.checkInTime, r.checkOutTime${marks}
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
      ...(isArrivalValidated(row) ? { arrivalValidated: true } : {}),
    };
  }

  function phaseForReservation(id, now) {
    const inputs = phaseInputsFor(id);
    return inputs ? phaseOf(inputs, now) : null;
  }

  return { phaseForReservation, phaseInputsFor };
}

const productionModel = () => create(require('../database'));

// Rule 102 — the gesture's moment lives with the server clock (utils/localDate.js); re-exported here for the stay clock's readers.
const { withNow, gestureNow } = require('../utils/localDate');

module.exports = {
  create,
  phaseForReservation: (id, now) => productionModel().phaseForReservation(id, now),
  phaseInputsFor: (id) => productionModel().phaseInputsFor(id),
  withNow,
  gestureNow,
  dayReached,
  dayPassed,
};
