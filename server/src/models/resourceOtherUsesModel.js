/**
 * What else uses a resource on a date, for the fiche save's conflict check
 * (specs/hourly-resource-quantity-and-sas-scheduling.md rule 28 « and vice versa », fixed at the
 * 2026-10-27 spec review): the external bookings and the sessions of the OTHER stays. The same union the
 * hourly-resources plugin's occupancy model reads when an external booking is created; `resource_bookings`
 * and `resources.turnoverMinutes` exist only once that plugin is installed, hence the guards.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseSessions(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  let list;
  try { list = JSON.parse(raw); } catch { return []; }
  return Array.isArray(list) ? list.filter((s) => s && ISO_DATE.test(String(s.date || '').slice(0, 10))) : [];
}

function buildModel(database) {
  const hasTable = (name) => Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  const hasColumn = (table, column) => {
    try { return database.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column); }
    catch { return false; }
  };

  return {
    // `[{ start, end }]` of the external bookings and other stays' sessions of `resourceId` on `date`.
    occupiedOn({ resourceId, date, excludeReservationId = null }) {
      const exclude = Number(excludeReservationId) || 0;
      const out = [];
      if (hasTable('resource_bookings')) {
        const linked = hasColumn('resource_bookings', 'reservationId') ? 'reservationId' : 'NULL AS reservationId';
        database.prepare(`SELECT startTime, endTime, ${linked} FROM resource_bookings WHERE resourceId = ? AND date = ?`)
          .all(Number(resourceId), String(date))
          .filter((b) => !exclude || Number(b.reservationId || 0) !== exclude)
          .forEach((b) => out.push({ start: b.startTime, end: b.endTime }));
      }
      if (hasColumn('reservation_resources', 'sessions')) {
        database.prepare(`
          SELECT rr.reservationId, rr.sessions FROM reservation_resources rr
            JOIN reservations res ON res.id = rr.reservationId
           WHERE rr.resourceId = ? AND res.kind = 'reservation' AND rr.reservationId != ?
             AND rr.sessions IS NOT NULL AND TRIM(rr.sessions) != ''
        `).all(Number(resourceId), exclude)
          .forEach((row) => parseSessions(row.sessions)
            .filter((s) => String(s.date).slice(0, 10) === String(date))
            .forEach((s) => out.push({ start: s.start, end: s.end })));
      }
      return out;
    },

    turnoverOf(resourceId) {
      if (!hasColumn('resources', 'turnoverMinutes')) return 0;
      const row = database.prepare('SELECT turnoverMinutes FROM resources WHERE id = ?').get(Number(resourceId));
      return Number(row && row.turnoverMinutes) || 0;
    },

    // The sessions this stay already has on the resource, as stored.
    storedSessions({ reservationId, resourceId }) {
      if (!reservationId || !hasColumn('reservation_resources', 'sessions')) return [];
      const row = database.prepare('SELECT sessions FROM reservation_resources WHERE reservationId = ? AND resourceId = ?')
        .get(Number(reservationId), Number(resourceId));
      return parseSessions(row && row.sessions);
    },
  };
}

const db = require('../database');
const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;

module.exports = defaultModel;
