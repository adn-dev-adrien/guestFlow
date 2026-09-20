// iCal model — public-export token lifecycle + the property `.ics` feed generation.
// Moved out of database.js. The export advertises ONLY real reservations (kind='reservation'); a devis
// (kind='devis') must never appear in the public feed, or external platforms would treat a tentative
// quote as booked and block real reservations.
//
// It also advertises the establishment closures that apply to the property (specs/ical-export-closures.md).
// Without them a platform happily sells a period the operator declared closed, and the sync guard added
// in 2026-06 can only drop the incoming booking — the guest keeps a confirmation for a stay that leaves
// no trace at all in GuestFlow. Exporting the closure prevents the sale instead.

const crypto = require('crypto');
const db = require('../database');
const establishmentClosuresModel = require('./establishmentClosuresModel');

const DEFAULT_CLOSURE_LABEL = 'Fermeture établissement';
const CLOSURE_DESCRIPTION = 'Période de fermeture — aucune réservation possible.';

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

// The platform displays SUMMARY as-is in its own calendar, next to real guests: the prefix is what
// tells the operator, looking at Booking, that the block is not a booking. A label left at the DB
// default would read "Fermeture — Fermeture établissement", so it collapses to the prefix alone.
function closureSummary(label) {
  const trimmed = String(label || '').trim();
  if (!trimmed || trimmed === DEFAULT_CLOSURE_LABEL) return 'Fermeture';
  return `Fermeture — ${trimmed}`;
}

function closureEventLines(closure) {
  return [
    'BEGIN:VEVENT',
    // Own UID namespace, stable across fetches: the platform updates the same block instead of
    // stacking duplicates, and it can never collide with a reservation's.
    `UID:closure-${closure.id}@guestflow.local`,
    `DTSTAMP:${formatIcalDate(new Date())}`,
    // Closures use the reservation convention — start inclusive, end exclusive — so both columns go
    // in untouched: a closure 2026-11-01 → 2027-03-01 blocks the nights of 1 Nov through 28 Feb and
    // leaves 1 March bookable.
    `DTSTART:${formatIcalDate(new Date(closure.startDate))}`,
    `DTEND:${formatIcalDate(new Date(closure.endDate))}`,
    `SUMMARY:${escapeIcalText(closureSummary(closure.label))}`,
    `DESCRIPTION:${CLOSURE_DESCRIPTION}`,
    // No ATTENDEE: a closure has no guest.
    'TRANSP:OPAQUE',
    'END:VEVENT',
  ];
}

function createIcalModel(database) {
  const closures = establishmentClosuresModel.create(database);

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

    // Build the property's iCal feed: real reservations (kind='reservation', never a devis) followed
    // by the closures that apply to this property.
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

      // `list` already scopes to this property's own closures ∪ the global ones, drops those that are
      // over (endDate > from — an ongoing closure stays, which is the one that matters most) and
      // orders by startDate. Nothing to re-derive here.
      closures.list({ propertyId, from: new Date().toISOString().slice(0, 10) })
        .forEach((closure) => lines.push(...closureEventLines(closure)));

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
