/**
 * Calendar model — the one read both calendars share (specs/calendar-property-parity.md rules 1-3).
 *
 * `listRange` answers « the all-logements calendar » when no logement is given and « the calendar of
 * one logement » when one is: the second is exactly the first restricted to that logement, so the
 * two can never disagree on which stays exist. Every `kind = 'reservation'` row is returned, whatever
 * its platform and whatever the state of that platform's iCal source (rule 2). The server also shapes
 * what a bar prints — label, platform name, colour, text colour, past flag — so the client does none
 * of it (rule 3).
 *
 * Factory `create(db)` (+ a default bound to the production database), like the other models.
 */
const db = require('../database');
const platformsModel = require('./platformsModel');
const establishmentClosuresModel = require('./establishmentClosuresModel');
const { platformDisplay } = require('../utils/platformDisplay');
const { textColorFor } = require('../utils/colorContrast');
const { todayIso } = require('../utils/localDate');

const DEFAULT_CLOSURE_LABEL = 'Fermeture établissement';

function shiftIso(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function stayLabel(row) {
  return `${row.firstName || ''} ${row.lastName || ''}`.trim()
    || String(row.icalOriginalSummary || '').trim()
    || `Réservation #${row.id}`;
}

function createModel(database) {
  const platforms = platformsModel.create(database);
  const closures = establishmentClosuresModel.create(database);

  return {
    propertyExists(propertyId) {
      return Boolean(database.prepare('SELECT 1 FROM properties WHERE id = ?').get(Number(propertyId)));
    },

    listRange({ from, to, propertyId = null, today = todayIso() }) {
      let sql = `
        SELECT r.id, r.propertyId, p.name AS propertyName, r.startDate, r.endDate, r.checkInTime, r.checkOutTime,
               c.firstName, c.lastName, r.platform, r.icalOriginalSummary, r.bookingConflictAt
          FROM reservations r
          JOIN clients c ON c.id = r.clientId
          JOIN properties p ON p.id = r.propertyId
         WHERE r.kind = 'reservation' AND r.endDate >= ? AND r.startDate <= ?
      `;
      const params = [from, to];
      if (propertyId != null) { sql += ' AND r.propertyId = ?'; params.push(Number(propertyId)); }
      sql += ' ORDER BY r.startDate, r.id';

      const colorOf = platforms.colorResolver();
      const stays = database.prepare(sql).all(...params).map((row) => {
        const color = colorOf(row.platform);
        return {
          id: row.id,
          propertyId: row.propertyId,
          propertyName: row.propertyName,
          startDate: row.startDate,
          endDate: row.endDate,
          checkInTime: row.checkInTime,
          checkOutTime: row.checkOutTime,
          firstName: row.firstName,
          lastName: row.lastName,
          label: stayLabel(row),
          platform: row.platform,
          platformDisplay: platformDisplay(row.platform),
          color,
          textColor: textColorFor(color),
          past: row.endDate <= today,
          bookingConflictAt: row.bookingConflictAt || null,
        };
      });

      // A closure ends on its reopening day, drawn to mid-day like a departure: it still touches `from`.
      const closureRows = closures
        .list({ propertyId: propertyId ?? undefined, from: shiftIso(from, -1), to: shiftIso(to, 1) })
        .map((row) => ({
          id: row.id,
          propertyId: row.propertyId,
          propertyName: row.propertyName || null,
          global: row.propertyId == null,
          label: row.label || DEFAULT_CLOSURE_LABEL,
          startDate: row.startDate,
          endDate: row.endDate,
        }));

      return { from, to, today, stays, closures: closureRows };
    },
  };
}

const defaultModel = createModel(db);
defaultModel.create = createModel;

module.exports = defaultModel;
