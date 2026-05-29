const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const propertyIcalModel = require('../models/propertyIcalModel');

// Guards the iCal anti-overbooking contract: create / update / locked-skip / stale-removal /
// unavailable-filter. The sync engine was moved verbatim from routes/properties.js — this locks it in.

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, defaultCheckIn TEXT, defaultCheckOut TEXT, defaultCautionAmount REAL);
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, notes TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, clientId INTEGER,
    startDate TEXT, endDate TEXT, adults INTEGER, children INTEGER, teens INTEGER, babies INTEGER,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER, checkInTime TEXT, checkOutTime TEXT,
    platform TEXT, totalPrice REAL, discountPercent REAL, finalPrice REAL,
    depositAmount REAL, depositDueDate TEXT, depositPaid INTEGER,
    balanceAmount REAL, balanceDueDate TEXT, balancePaid INTEGER,
    sourceType TEXT, sourcePlatformKey TEXT, sourceIcalSourceId INTEGER, sourceIcalEventUid TEXT, icalSyncLocked INTEGER,
    notes TEXT, cautionAmount REAL, updatedAt TEXT
  );
  CREATE TABLE ical_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, name TEXT, url TEXT, platformKey TEXT,
    platformLabel TEXT, platformColor TEXT, isActive INTEGER DEFAULT 1,
    lastSyncAt TEXT, lastSyncStatus TEXT, lastSyncMessage TEXT, lastImportedCount INTEGER, createdAt TEXT, updatedAt TEXT
  );
  CREATE TABLE ical_import_events (
    sourceId INTEGER, eventUid TEXT, reservationId INTEGER, eventHash TEXT,
    startDate TEXT, endDate TEXT, summaryNormalized TEXT, lastSeenAt TEXT,
    UNIQUE(sourceId, eventUid)
  );
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT);
`;

function icsFeed(events) {
  const lines = ['BEGIN:VCALENDAR'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART;VALUE=DATE:${e.start}`, `DTEND;VALUE=DATE:${e.end}`, `SUMMARY:${e.summary}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function stubFetch(events) {
  global.fetch = async () => ({ ok: true, text: async () => icsFeed(events) });
}

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, defaultCheckIn, defaultCheckOut, defaultCautionAmount) VALUES (1, '15:00', '10:00', 500)").run();
  const model = propertyIcalModel.buildModel(db);
  const source = { id: 1, propertyId: 1, url: 'http://feed.test/ical', platformKey: 'airbnb', platformLabel: 'Airbnb', name: 'Airbnb' };
  return { db, model, source };
}

const origFetch = global.fetch;
test.afterEach(() => { global.fetch = origFetch; });

test('create: a new iCal event becomes an ical reservation', async () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  const result = await model.syncSource(source);
  assert.equal(result.createdCount, 1);
  const row = db.prepare('SELECT * FROM reservations').get();
  assert.equal(row.sourceType, 'ical');
  assert.equal(row.startDate, '2026-07-10');
  assert.equal(row.endDate, '2026-07-13');
  assert.equal(row.sourceIcalEventUid, 'E1');
});

test('update: a changed event updates the same reservation (hash differs)', async () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260715', summary: 'Jean Dupont' }]);
  const result = await model.syncSource(source);
  assert.equal(result.updatedCount, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations').get().c, 1);
  assert.equal(db.prepare('SELECT endDate FROM reservations').get().endDate, '2026-07-15');
});

test('locked: a locked iCal reservation is NOT overwritten on re-sync', async () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  db.prepare("UPDATE reservations SET icalSyncLocked = 1 WHERE sourceIcalEventUid = 'E1'").run();

  stubFetch([{ uid: 'E1', start: '20260710', end: '20260720', summary: 'Jean Dupont' }]);
  const result = await model.syncSource(source);
  assert.equal(result.lockedCount, 1);
  assert.equal(result.updatedCount, 0);
  assert.equal(db.prepare('SELECT endDate FROM reservations').get().endDate, '2026-07-13'); // unchanged
});

test('stale: an event no longer in the feed removes its reservation', async () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  stubFetch([]);
  const result = await model.syncSource(source);
  assert.equal(result.removedCount, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations').get().c, 0);
});

test('unavailable/blocked events are filtered out (no reservation)', async () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'B1', start: '20260710', end: '20260713', summary: 'Blocked' }]);
  const result = await model.syncSource(source);
  assert.equal(result.createdCount, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations').get().c, 0);
});

test('update with a renamed guest does not create an orphan client', async () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM clients').get().c, 1);

  // Same UID, different summary → an update (hash changes). The client must not be re-created
  // (the update never relinks clientId, so resolving a new client would orphan it).
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Marie Martin' }]);
  const result = await model.syncSource(source);
  assert.equal(result.updatedCount, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM clients').get().c, 1);
});

test('syncSourceAndRecord writes the source status row', async () => {
  const { db, model, source } = freshModel();
  db.prepare("INSERT INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel, isActive) VALUES (1, 1, 'Airbnb', 'http://feed.test/ical', 'airbnb', 'Airbnb', 1)").run();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSourceAndRecord(source);
  const row = db.prepare('SELECT lastSyncStatus, lastImportedCount FROM ical_sources WHERE id = 1').get();
  assert.equal(row.lastSyncStatus, 'success');
  assert.equal(row.lastImportedCount, 1);
});
