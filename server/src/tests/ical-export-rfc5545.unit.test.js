// specs/ical-export-closures.md rule 11 (2026-10-27 spec review) — the exported feed is RFC 5545
// conformant: DTSTART/DTEND are all-day `;VALUE=DATE` values (the dates a platform reads are unchanged)
// and DTSTAMP is a UTC date-time. Our own importer reads its feed back to the same nights.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const icalModel = require('../models/icalModel');
const { parseIcsEvents } = require('../utils/icalParser');

function feed() {
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
    INSERT INTO clients VALUES (1, 'Marie', 'Vasseur', NULL, NULL);
    INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform) VALUES (1, 1, '2099-07-10', '2099-07-13', 'Airbnb');
    INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (1, 'Hiver', '2099-11-01', '2100-03-01');
  `);
  return icalModel.buildModel(db).exportProperty(1);
}

const events = (ics) => ics.split('BEGIN:VEVENT').slice(1).map((block) => block.split('END:VEVENT')[0].trim().split('\r\n'));

test('every event carries all-day dates with VALUE=DATE and a UTC date-time DTSTAMP', () => {
  const found = events(feed());
  assert.equal(found.length, 2);
  found.forEach((lines) => {
    assert.ok(lines.some((l) => /^DTSTAMP:\d{8}T\d{6}Z$/.test(l)), lines.join(' | '));
    assert.ok(lines.some((l) => /^DTSTART;VALUE=DATE:\d{8}$/.test(l)), lines.join(' | '));
    assert.ok(lines.some((l) => /^DTEND;VALUE=DATE:\d{8}$/.test(l)), lines.join(' | '));
    assert.equal(lines.some((l) => /^DTSTART:|^DTEND:/.test(l)), false);
  });
  const [stay, closure] = found;
  assert.ok(stay.includes('DTSTART;VALUE=DATE:20990710') && stay.includes('DTEND;VALUE=DATE:20990713'));
  assert.ok(closure.includes('DTSTART;VALUE=DATE:20991101') && closure.includes('DTEND;VALUE=DATE:21000301'));
});

test('the stamp is the generation instant in UTC', () => {
  const { formatIcalStamp } = icalModel.__test;
  assert.equal(formatIcalStamp(new Date('2026-10-27T21:05:09.123Z')), '20261027T210509Z');
});

test('the importer reads the feed back to the same dates', () => {
  const parsed = parseIcsEvents(feed(), { keepUnavailable: true, now: new Date('2099-01-01T00:00:00Z') });
  const dates = parsed.map((e) => [e.startDate, e.endDate]).sort();
  assert.deepEqual(dates, [['2099-07-10', '2099-07-13'], ['2099-11-01', '2100-03-01']]);
});
