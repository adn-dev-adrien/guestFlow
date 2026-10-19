// specs/ical-export-guest-privacy.md — the public iCal feed of a property says « Réservé » on its
// dates and nothing about the guest: every platform subscribed to it reads it.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const icalModel = require('../models/icalModel');

function freshModel() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation', propertyId INTEGER, clientId INTEGER,
      startDate TEXT, endDate TEXT, platform TEXT, adults INTEGER, children INTEGER, notes TEXT
    );
    CREATE TABLE ical_tokens (propertyId INTEGER, token TEXT);
    CREATE TABLE establishment_closures (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, label TEXT,
      startDate TEXT, endDate TEXT, createdAt TEXT, updatedAt TEXT);
    INSERT INTO properties (id, name) VALUES (1, 'La Granja');
    INSERT INTO clients VALUES (1, 'Marie', 'Vasseur', 'm.vasseur@example.fr', '+33612345678'),
                               (2, 'Hugo', 'Lambert', 'hugo.lambert@guest.booking.com', NULL);
    INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, children, notes) VALUES
      (1, 1, '2027-07-10', '2027-07-13', 'Airbnb', 4, 2, 'Code portail 1234'),
      (1, 2, '2027-08-01', '2027-08-05', 'Booking', 2, 0, '');
  `);
  return icalModel.buildModel(db);
}

const events = (ics) => ics.split('BEGIN:VEVENT').slice(1).map((block) => block.split('END:VEVENT')[0].trim().split('\r\n'));
const valueOf = (lines, key) => {
  const line = lines.find((l) => l.startsWith(`${key}:`) || l.startsWith(`${key};`));
  return line ? line.slice(line.indexOf(':') + 1) : null;
};

test('specs/ical-export-guest-privacy.md rule 1: every stay reads « Réservé », whoever the guest and whatever the platform', () => {
  const found = events(freshModel().exportProperty(1));
  assert.equal(found.length, 2);
  found.forEach((lines) => assert.equal(valueOf(lines, 'SUMMARY'), 'Réservé'));
});

test('specs/ical-export-guest-privacy.md rule 2: no name, e-mail, phone, platform, party or note reaches the feed', () => {
  const ics = freshModel().exportProperty(1);
  ['Marie', 'Vasseur', 'm.vasseur@example.fr', '+33612345678', 'Hugo', 'Lambert', 'guest.booking.com',
    'Airbnb', 'Booking', 'Adultes', 'Code portail', 'ATTENDEE', 'DESCRIPTION', 'mailto:']
    .forEach((needle) => assert.equal(ics.includes(needle), false, `${needle} leaked into the feed`));
});

test('specs/ical-export-guest-privacy.md rule 3: the UID and the dates keep their shape, so a platform updates the same block', () => {
  const [first] = events(freshModel().exportProperty(1));
  assert.equal(valueOf(first, 'UID'), 'reservation-1@guestflow.local');
  assert.equal(valueOf(first, 'DTSTART').replace(/^.*:/, ''), '20270710');
  assert.equal(valueOf(first, 'DTEND').replace(/^.*:/, ''), '20270713');
  assert.equal(valueOf(first, 'TRANSP'), 'OPAQUE');
});
