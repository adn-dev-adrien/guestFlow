/**
 * Planning days model (specs/dashboard-planning-scroll.md rules 1, 2, 8): the stays that start or end
 * in a window, and the first day after a date on which a stay starts. Devis and cancelled stays are
 * not arrivals nor departures; a stay without its client or property row is not shown anywhere else
 * either. Order: day, then the hour (an unset hour last), then id.
 */

const db = require('../database');

function createPlanningDaysModel(database) {
  const from = `
    FROM reservations r
    JOIN clients c ON r.clientId = c.id
    JOIN properties p ON r.propertyId = p.id
    WHERE r.kind = 'reservation'`;
  const arrivalsStmt = database.prepare(`
    SELECT r.id AS id, r.startDate AS date ${from} AND r.startDate BETWEEN ? AND ?
    ORDER BY r.startDate, COALESCE(NULLIF(r.checkInTime, ''), '23:59'), r.id`);
  const departuresStmt = database.prepare(`
    SELECT r.id AS id, r.endDate AS date ${from} AND r.endDate BETWEEN ? AND ?
    ORDER BY r.endDate, COALESCE(NULLIF(r.checkOutTime, ''), '23:59'), r.id`);
  const nextArrivalDayStmt = database.prepare(`SELECT MIN(r.startDate) AS day ${from} AND r.startDate > ?`);

  return {
    /** `[{ id, date }]` of the stays starting in `[from, to]`. */
    arrivalsInRange: (start, end) => arrivalsStmt.all(start, end),
    /** `[{ id, date }]` of the stays ending in `[from, to]`. */
    departuresInRange: (start, end) => departuresStmt.all(start, end),
    /** The first day after `date` on which a stay starts, or `null`. */
    nextArrivalDayAfter(date) {
      const row = nextArrivalDayStmt.get(date);
      return row && row.day ? row.day : null;
    },
  };
}

const defaultModel = createPlanningDaysModel(db);
defaultModel.create = createPlanningDaysModel;
module.exports = defaultModel;
