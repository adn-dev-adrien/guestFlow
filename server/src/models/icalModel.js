// iCal model — public-export token lifecycle + the property `.ics` feed generation.
// Moved out of database.js. The export advertises ONLY real reservations (kind='reservation'); a devis
// (kind='devis') must never appear in the public feed, or external platforms would treat a tentative
// quote as booked and block real reservations.

const crypto = require('crypto');
const db = require('../database');

function formatIcalDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function escapeIcalText(text) {
  if (!text) return '';
  return text.replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function createIcalModel(database) {
  const model = {
    propertyExists(propertyId) {
      return !!database.prepare('SELECT id FROM properties WHERE id = ?').get(Number(propertyId));
    },

    findPropertyIdByToken(token) {
      const row = database.prepare('SELECT propertyId FROM ical_tokens WHERE token = ?').get(token);
      return row ? row.propertyId : null;
    },

    getOrCreateToken(propertyId) {
      const existing = database.prepare('SELECT token FROM ical_tokens WHERE propertyId = ?').get(propertyId);
      if (existing) return existing.token;

      const token = crypto.randomBytes(32).toString('hex');
      try {
        database.prepare('INSERT INTO ical_tokens (propertyId, token) VALUES (?, ?)').run(propertyId, token);
        return token;
      } catch (err) {
        // Token row might already exist (race) — fetch it.
        const retry = database.prepare('SELECT token FROM ical_tokens WHERE propertyId = ?').get(propertyId);
        return retry ? retry.token : null;
      }
    },

    regenerateToken(propertyId) {
      const newToken = crypto.randomBytes(32).toString('hex');
      database.transaction(() => {
        database.prepare('DELETE FROM ical_tokens WHERE propertyId = ?').run(propertyId);
        database.prepare('INSERT INTO ical_tokens (propertyId, token) VALUES (?, ?)').run(propertyId, newToken);
      })();
      return newToken;
    },

    // Build the property's iCal feed. Only real reservations (kind='reservation') are exported.
    exportProperty(propertyId) {
      const property = database.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
      if (!property) return null;

      const reservations = database.prepare(`
        SELECT r.*, c.firstName, c.lastName, c.email
        FROM reservations r
        LEFT JOIN clients c ON r.clientId = c.id
        WHERE r.propertyId = ? AND r.kind = 'reservation'
        ORDER BY r.startDate
      `).all(propertyId);

      const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//GuestFlow//EN',
        'CALSCALE:GREGORIAN',
        `X-WR-CALNAME:${escapeIcalText(property.name)}`,
        'X-WR-TIMEZONE:Europe/Paris',
      ];

      reservations.forEach((r) => {
        const clientName = r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : 'Réservation';
        const eventUid = `reservation-${r.id}@guestflow.local`;

        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${eventUid}`);
        lines.push(`DTSTAMP:${formatIcalDate(new Date())}`);
        lines.push(`DTSTART:${formatIcalDate(new Date(r.startDate))}`);
        lines.push(`DTEND:${formatIcalDate(new Date(r.endDate))}`);
        lines.push(`SUMMARY:${escapeIcalText(clientName)}`);
        lines.push(`DESCRIPTION:${escapeIcalText(`Plateforme: ${r.platform}\nAdultes: ${r.adults}, Enfants: ${r.children}`)}`);
        if (r.email) {
          lines.push(`ATTENDEE:mailto:${r.email}`);
        }
        lines.push('TRANSP:OPAQUE');
        lines.push('END:VEVENT');
      });

      lines.push('END:VCALENDAR');
      return lines.join('\r\n');
    },
  };

  return model;
}

const defaultModel = createIcalModel(db);
defaultModel.buildModel = createIcalModel;
defaultModel.__test = { escapeIcalText, formatIcalDate };

module.exports = defaultModel;
