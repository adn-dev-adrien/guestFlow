// specs/ical-export-closures.md rule 12 — the feed publishes the nights GuestFlow itself refuses: a
// check-in at 10:00 or earlier takes the night before, a check-out at 17:00 or later the night after
// (audit 2026-10-28). The tombstone snapshot follows the same ranges.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const icalModel = require('../models/icalModel');
const reservationsModel = require('../models/reservationsModel');
const icalExportRangesModel = require('../models/icalExportRangesModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed(times) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'La Granja')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Marie', 'Vasseur')").run();
  db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, checkInTime, checkOutTime)
              VALUES (1, 1, '2099-07-10', '2099-07-13', 'Direct', ?, ?)`).run(times.in, times.out);
  return db;
}

const range = (ics) => [/DTSTART;VALUE=DATE:(\d{8})/.exec(ics)[1], /DTEND;VALUE=DATE:(\d{8})/.exec(ics)[1]];

test('ordinary times export the stay dates', () => {
  assert.deepEqual(range(icalModel.buildModel(seed({ in: '15:00', out: '10:00' })).exportProperty(1)), ['20990710', '20990713']);
});

test('a late check-out exports the night it blocks', () => {
  assert.deepEqual(range(icalModel.buildModel(seed({ in: '15:00', out: '18:00' })).exportProperty(1)), ['20990710', '20990714']);
});

test('an early check-in exports the night before', () => {
  assert.deepEqual(range(icalModel.buildModel(seed({ in: '09:00', out: '10:00' })).exportProperty(1)), ['20990709', '20990713']);
});

test('the export agrees with the availability check: the exported night is refused to a new stay', () => {
  const db = seed({ in: '15:00', out: '18:00' });
  const [, end] = range(icalModel.buildModel(db).exportProperty(1));
  assert.equal(end, '20990714');
  const refused = reservationsModel.create(db).validateAvailability(1, '2099-07-13', '2099-07-15', '15:00', '10:00', null, {}, { allowPastDates: true });
  assert.match(refused.error, /déjà réservé/);
});

test('the tombstone left by a stay carries the exported (effective) range', () => {
  const db = seed({ in: '15:00', out: '18:00' });
  icalModel.buildModel(db).exportProperty(1);
  db.prepare('DELETE FROM reservations').run();
  const ranges = icalExportRangesModel.create(db);
  assert.equal(ranges.refresh(1), 1);
  const [tombstone] = ranges.listActiveTombstones(1);
  assert.deepEqual([tombstone.startDate, tombstone.endDate], ['2099-07-10', '2099-07-14']);
});
