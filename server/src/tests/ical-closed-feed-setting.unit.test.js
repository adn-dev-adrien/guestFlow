// specs/lodgify-decommission.md §3 rule 16 (audit 2026-10-27) — « the feed marks every stay CLOSED - Not
// available » is a setting of the iCal source, not the exact slug `booking`. Registered as `booking-com`
// or `booking-tente`, a Booking calendar used to drop every stay at parse time, then cancel them all
// through the empty-feed sweep.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const db = require('../database');
const { globalFetch } = require('./icalFetchFixture');
const model = require('../models/propertyIcalModel').buildModel(require('../database'), { fetchImpl: globalFetch });
const platformsModel = require('../models/platformsModel');
const { runClosedFeedMigration, defaultMarksStaysClosed } = require('../utils/icalClosedFeed');

function ics(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART;VALUE=DATE:${e.start}`, `DTEND;VALUE=DATE:${e.end}`, 'SUMMARY:CLOSED - Not available', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
const feed = (events) => { global.fetch = async () => ({ ok: true, status: 200, text: async () => ics(events) }); };
const origFetch = global.fetch;
test.afterEach(() => { global.fetch = origFetch; });

const newProperty = () => Number(db.prepare("INSERT INTO properties (name, defaultCheckIn, defaultCheckOut) VALUES ('Tente', '16:00', '10:00')").run().lastInsertRowid);
const count = (propertyId) => db.prepare('SELECT COUNT(*) c FROM reservations WHERE propertyId = ?').get(propertyId).c;

for (const platformLabel of ['Booking.com', 'BookingTente']) {
  test(`a calendar created as « ${platformLabel} » keeps its CLOSED stays`, async () => {
    const propertyId = newProperty();
    const { data: source } = model.createSource(propertyId, { platformLabel, url: 'https://b.test/f.ics' });
    assert.equal(source.feedMarksStaysClosed, 1, 'a new Booking-like source starts ticked');
    feed([{ uid: 'B1', start: '20270707', end: '20270710' }]);
    const r = await model.syncSourceAndRecord(source);
    assert.equal(r.createdCount, 1);
    assert.equal(count(propertyId), 1);
  });
}

test('the setting, not the name, decides: ticked on any feed it keeps CLOSED stays; unticked it drops them', async () => {
  const propertyId = newProperty();
  const { data: other } = model.createSource(propertyId, { platformLabel: 'Monchannel', url: 'https://c.test/f.ics' });
  assert.equal(other.feedMarksStaysClosed, 0);
  feed([{ uid: 'C1', start: '20270707', end: '20270710' }]);
  assert.equal((await model.syncSourceAndRecord(other)).createdCount, 0);

  model.updateSource(propertyId, other.id, { feedMarksStaysClosed: true });
  const ticked = db.prepare('SELECT * FROM ical_sources WHERE id = ?').get(other.id);
  assert.equal((await model.syncSourceAndRecord(ticked)).createdCount, 1);

  const { data: booking } = model.createSource(propertyId, { platformLabel: 'Booking', url: 'https://b.test/f.ics' });
  model.updateSource(propertyId, booking.id, { feedMarksStaysClosed: false });
  feed([{ uid: 'B9', start: '20270801', end: '20270803' }]);
  assert.equal((await model.syncSourceAndRecord(booking)).createdCount, 0, 'unticked by the operator');
  assert.equal(db.prepare('SELECT feedMarksStaysClosed f FROM ical_sources WHERE id = ?').get(booking.id).f, 0);
  model.updateSource(propertyId, booking.id, { url: 'https://b.test/g.ics' });
  assert.equal(db.prepare('SELECT feedMarksStaysClosed f FROM ical_sources WHERE id = ?').get(booking.id).f, 0, 'an edit that does not send it keeps it');
});

test('the platforms tab payload carries the setting', () => {
  const propertyId = newProperty();
  const { data } = model.createSource(propertyId, { platformLabel: 'BookingTente', url: '' });
  const row = platformsModel.listForProperty(propertyId).find((r) => r.sourceId === data.id);
  assert.equal(row.feedMarksStaysClosed, true);
  const airbnb = platformsModel.listForProperty(propertyId).find((r) => r.platformLabel === 'Airbnb');
  assert.equal(airbnb.feedMarksStaysClosed, false);
});

test('the one-shot migration ticks every existing Booking-like source, whatever its spelling', () => {
  const mem = new Database(':memory:');
  mem.exec('CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, name TEXT, platformKey TEXT, platformLabel TEXT, feedMarksStaysClosed INTEGER)');
  mem.prepare(`INSERT INTO ical_sources (id, name, platformKey, platformLabel) VALUES
    (1, 'Booking', 'booking', 'Booking'), (2, 'BookingCom', 'booking-com', 'BookingCom'),
    (3, 'BookingTente', 'booking-tente', 'BookingTente'), (4, 'Airbnb', 'airbnb', 'Airbnb'), (5, 'Abritel', 'abritel', 'Abritel')`).run();
  assert.equal(runClosedFeedMigration(mem), 3);
  assert.deepEqual(mem.prepare('SELECT id FROM ical_sources WHERE feedMarksStaysClosed = 1 ORDER BY id').all().map((r) => r.id), [1, 2, 3]);
});

test('a source whose setting was never chosen follows its platform spelling', async () => {
  const propertyId = newProperty();
  const id = db.prepare("INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel) VALUES (?, 'BookingCom', 'https://b.test/f.ics', 'booking-com', 'BookingCom')").run(propertyId).lastInsertRowid;
  const source = db.prepare('SELECT * FROM ical_sources WHERE id = ?').get(id);
  assert.equal(source.feedMarksStaysClosed, null);
  feed([{ uid: 'B1', start: '20270707', end: '20270710' }]);
  assert.equal((await model.syncSourceAndRecord(source)).createdCount, 1);
});

test('without the column (older schema) the sync falls back to the platform spelling', () => {
  assert.equal(defaultMarksStaysClosed('booking-com'), true);
  assert.equal(defaultMarksStaysClosed(null, 'Booking.com'), true);
  assert.equal(defaultMarksStaysClosed('airbnb', 'Airbnb'), false);
});
