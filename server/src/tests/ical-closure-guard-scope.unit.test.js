// specs/lodgify-decommission.md §3 rule 17 (audit 2026-10-27) — the closure guard drops only a NEW event
// whose every night is inside a closure (the closure coming back from a channel). It used to drop any
// overlapping event: a stay the platform moved onto a closure stayed frozen on its old dates without a
// word, and a new booking partly over a closure never existed in GuestFlow.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const { globalFetch } = require('./icalFetchFixture');
const model = require('../models/propertyIcalModel').buildModel(require('../database'), { fetchImpl: globalFetch });

function ics(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART;VALUE=DATE:${e.start}`, `DTEND;VALUE=DATE:${e.end}`, 'SUMMARY:Reserved', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
const feed = (events) => { global.fetch = async () => ({ ok: true, status: 200, text: async () => ics(events) }); };
const origFetch = global.fetch;
test.afterEach(() => { global.fetch = origFetch; });

function setup() {
  const propertyId = Number(db.prepare("INSERT INTO properties (name, defaultCheckIn, defaultCheckOut) VALUES ('Gîte', '16:00', '10:00')").run().lastInsertRowid);
  const id = db.prepare("INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, isActive) VALUES (?, 'Airbnb', 'http://x.test/f.ics', 'airbnb', 'Airbnb', 1)").run(propertyId).lastInsertRowid;
  db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (?, 'Travaux', '2027-07-12', '2027-07-19')").run(propertyId);
  return { propertyId, source: db.prepare('SELECT * FROM ical_sources WHERE id = ?').get(id) };
}
const stays = (propertyId) => db.prepare('SELECT id, startDate, endDate, bookingConflictAt FROM reservations WHERE propertyId = ? ORDER BY id').all(propertyId);

test('a new event entirely inside a closure is still skipped (the echo case)', async () => {
  const { propertyId, source } = setup();
  feed([{ uid: 'E', start: '20270713', end: '20270718' }]);
  const r = await model.syncSourceAndRecord(source);
  assert.equal(r.skippedClosureCount, 1);
  assert.equal(stays(propertyId).length, 0);
});

test('a new booking partly over a closure is created and flagged in conflict', async () => {
  const { propertyId, source } = setup();
  feed([{ uid: 'N', start: '20270718', end: '20270722' }]);
  const r = await model.syncSourceAndRecord(source);
  assert.equal(r.skippedClosureCount, 0);
  assert.equal(r.createdCount, 1);
  const [stay] = stays(propertyId);
  assert.ok(stay.bookingConflictAt);
  assert.deepEqual(r.conflictReservationIds, [stay.id]);
});

test('a pristine stay the platform moves onto a closure follows its feed and is flagged', async () => {
  const { propertyId, source } = setup();
  feed([{ uid: 'A1', start: '20270705', end: '20270710' }]);
  await model.syncSourceAndRecord(source);
  feed([{ uid: 'A1', start: '20270709', end: '20270714' }]);
  const r = await model.syncSourceAndRecord(source);
  assert.equal(r.updatedCount, 1);
  assert.equal(r.skippedClosureCount, 0);
  const [stay] = stays(propertyId);
  assert.equal(stay.startDate, '2027-07-09');
  assert.ok(stay.bookingConflictAt);
  assert.deepEqual(r.movedIntoConflictIds, [stay.id]);
});

test('a locked stay moved onto a closure raises its date-drift alert', async () => {
  const { propertyId, source } = setup();
  feed([{ uid: 'A1', start: '20270705', end: '20270710' }]);
  await model.syncSourceAndRecord(source);
  const [before] = stays(propertyId);
  db.prepare('UPDATE reservations SET icalSyncLocked = 1 WHERE id = ?').run(before.id);
  feed([{ uid: 'A1', start: '20270713', end: '20270716' }]);
  const r = await model.syncSourceAndRecord(source);
  assert.equal(r.lockedCount, 1);
  assert.equal(r.skippedClosureCount, 0, 'a known stay is never skipped by the closure guard');
  const drift = db.prepare('SELECT newStartDate FROM ical_date_drift_alerts WHERE reservationId = ? AND acknowledgedAt IS NULL').get(before.id);
  assert.equal(drift.newStartDate, '2027-07-13');
  assert.equal(stays(propertyId)[0].startDate, '2027-07-05', 'kept until the operator decides');
});
