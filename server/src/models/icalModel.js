// iCal model — public-export token lifecycle + the property `.ics` feed generation.
// Moved out of database.js. The export advertises ONLY real reservations (kind='reservation'); a devis
// (kind='devis') must never appear in the public feed, or external platforms would treat a tentative
// quote as booked and block real reservations.
//
// It carries no guest data (specs/ical-export-guest-privacy.md): every platform subscribed to the feed
// reads it, so a guest's name or e-mail in it would hand one platform's guests to its competitors.
//
// It also advertises the establishment closures that apply to the property (specs/ical-export-closures.md).
// Without them a platform happily sells a period the operator declared closed, and the sync guard added
// in 2026-06 can only drop the incoming booking — the guest keeps a confirmation for a stay that leaves
// no trace at all in GuestFlow. Exporting the closure prevents the sale instead.

const { todayIso: localTodayIso } = require('../utils/localDate');
const crypto = require('crypto');
const db = require('../database');
const establishmentClosuresModel = require('./establishmentClosuresModel');
const icalExportRangesModel = require('./icalExportRangesModel');
const { effectiveRange, timeColumnsOf } = require('../utils/occupancy');

const DEFAULT_CLOSURE_LABEL = 'Fermeture établissement';
// specs/ical-export-guest-privacy.md rule 1 — the same word for every stay, whoever the guest is.
const RESERVATION_SUMMARY = 'Réservé';
const CLOSURE_DESCRIPTION = 'Période de fermeture — aucune réservation possible.';

function formatIcalDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function escapeIcalText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

// RFC 5545 §3.1: a content line is at most 75 octets; the rest continues on lines starting with a
// space. Never cuts inside a multi-byte character.
function foldLine(line) {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const parts = [];
  let current = '';
  let limit = 75;
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > limit) {
      parts.push(current);
      current = '';
      limit = 74;
    }
    current += char;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

// The platform displays SUMMARY as-is in its own calendar, next to real guests: the prefix is what
// tells the operator, looking at Booking, that the block is not a booking. A label left at the DB
// default would read "Fermeture — Fermeture établissement", so it collapses to the prefix alone.
function closureSummary(label) {
  const trimmed = String(label || '').trim();
  if (!trimmed || trimmed === DEFAULT_CLOSURE_LABEL) return 'Fermeture';
  return `Fermeture — ${trimmed}`;
}

// The stamp and the two dates of an event. Stays and closures share the convention — start
// inclusive, end exclusive — so both columns go in untouched: a closure 2026-11-01 → 2027-03-01 blocks
// the nights of 1 Nov through 28 Feb and leaves 1 March bookable.
//
// RFC 5545 (2026-10-27 spec review, specs/ical-export-closures.md rule 11): the two dates are all-day
// values, so they say `;VALUE=DATE` — the dates a platform reads are unchanged — and DTSTAMP is the UTC
// date-time the feed was generated (§3.8.7.2 types it DATE-TIME; a date alone is invalid there).
function formatIcalStamp(date) {
  return `${date.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

function eventDateLines(startDate, endDate, now = new Date()) {
  return [
    `DTSTAMP:${formatIcalStamp(now)}`,
    `DTSTART;VALUE=DATE:${formatIcalDate(new Date(startDate))}`,
    `DTEND;VALUE=DATE:${formatIcalDate(new Date(endDate))}`,
  ];
}

// specs/ical-export-guest-privacy.md rules 1-3 — what a platform learns of a stay: its dates, nothing
// else. The UID keeps its namespace so a platform updates the same block across fetches.
function reservationEventLines(reservation) {
  return [
    'BEGIN:VEVENT',
    `UID:reservation-${reservation.id}@guestflow.local`,
    ...eventDateLines(reservation.startDate, reservation.endDate),
    `SUMMARY:${RESERVATION_SUMMARY}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
  ];
}

function closureEventLines(closure) {
  return [
    'BEGIN:VEVENT',
    // Own UID namespace, stable across fetches: the platform updates the same block instead of
    // stacking duplicates, and it can never collide with a reservation's.
    `UID:closure-${closure.id}@guestflow.local`,
    ...eventDateLines(closure.startDate, closure.endDate),
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

      // Only what the event needs: the guest's columns never leave the database (privacy rule 2).
      // The nights published are the ones GuestFlow itself refuses: an early check-in takes the night
      // before, a late check-out the night after (the times are read, never exported).
      const reservations = database.prepare(`
        SELECT ${['id', 'startDate', 'endDate', ...timeColumnsOf(database)].join(', ')}
        FROM reservations
        WHERE propertyId = ? AND kind = 'reservation'
        ORDER BY startDate
      `).all(propertyId).map((r) => ({ id: r.id, ...effectiveRange(r) }));

      const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//GuestFlow//EN',
        'CALSCALE:GREGORIAN',
        `X-WR-CALNAME:${escapeIcalText(property.name)}`,
        'X-WR-TIMEZONE:Europe/Paris',
      ];

      reservations.forEach((r) => lines.push(...reservationEventLines(r)));

      // `list` already scopes to this property's own closures ∪ the global ones, drops those that are
      // over (endDate > from — an ongoing closure stays, which is the one that matters most) and
      // orders by startDate. Nothing to re-derive here.
      closures.list({ propertyId, from: localTodayIso() })
        .forEach((closure) => lines.push(...closureEventLines(closure)));

      lines.push('END:VCALENDAR');
      // specs/lodgify-decommission.md §3 rule 7 — remember what was just served, so a stay that later
      // leaves the feed leaves a tombstone for the Booking echo filter. Never allowed to break the feed.
      try {
        icalExportRangesModel.create(database).refresh(propertyId);
      } catch (err) {
        console.warn(`[ical-export] export snapshot not refreshed for property ${propertyId}: ${err.message}`);
      }
      return lines.map(foldLine).join('\r\n');
    },
  };

  return model;
}

const defaultModel = createIcalModel(db);
defaultModel.buildModel = createIcalModel;
defaultModel.__test = { escapeIcalText, foldLine, formatIcalDate, formatIcalStamp, eventDateLines, RESERVATION_SUMMARY };

module.exports = defaultModel;
