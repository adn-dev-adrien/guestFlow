/**
 * Planning cleaning alerts model (specs/planning-arrival-alerts.md §3 rules 7–10): loads the stays
 * around the window — including the ones that started before it, whose checkout can collide with an
 * arrival of the window — and the properties' cleaning hours, then hands them to the pure
 * `utils/planningArrivalAlerts`.
 */

const { addDays } = require('../utils/dateDays');
const { computePlanningAlerts } = require('../utils/planningArrivalAlerts');

// A checkout further than this from the window cannot reach it through a cleaning, nor an arrival
// further than this be reached by a checkout of the window.
const MARGIN_DAYS = 7;

function buildModel(database) {
  const staysStmt = database.prepare(`
    SELECT r.id, r.propertyId, r.startDate, r.endDate, r.checkInTime, r.checkOutTime,
           r.icalOriginalSummary, c.firstName, c.lastName
      FROM reservations r
      LEFT JOIN clients c ON c.id = r.clientId
     WHERE r.kind = 'reservation' AND r.endDate >= ? AND r.startDate <= ?
  `);
  const propertiesStmt = database.prepare('SELECT id, cleaningHours FROM properties');

  return {
    alertsInRange({ from, to }) {
      const stays = staysStmt.all(addDays(from, -MARGIN_DAYS), addDays(to, MARGIN_DAYS));
      const cleaningHoursByProperty = Object.fromEntries(
        propertiesStmt.all().map((p) => [p.id, p.cleaningHours]),
      );
      return computePlanningAlerts({ stays, cleaningHoursByProperty, from, to });
    },
  };
}

const db = require('../database');
const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;

module.exports = defaultModel;
