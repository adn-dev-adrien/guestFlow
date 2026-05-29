const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const propertyIcalModel = require('../models/propertyIcalModel');

// iCal import de-duplication / no-overwrite guards. A re-import — same UID, a renamed UID, or the SAME
// booking arriving from another platform — must map to the EXISTING reservation, never duplicate it, and
// never overwrite a reservation the user has modified (icalSyncLocked).
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
    notes TEXT, cautionAmount REAL, icalOriginalSummary TEXT, updatedAt TEXT
  );
  CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER, name TEXT, platformKey TEXT, platformLabel TEXT);
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
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART;VALUE=DATE:${e.start}`, `DTEND;VALUE=DATE:${e.end}`, `SUMMARY:${e.summary}`);
    if (e.description) lines.push(`DESCRIPTION:${e.description}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function stubFetch(events) { global.fetch = async () => ({ ok: true, text: async () => icsFeed(events) }); }

const SOURCE_A = { id: 1, propertyId: 1, url: 'http://airbnb/ical', platformKey: 'airbnb', platformLabel: 'Airbnb', name: 'Airbnb' };
const SOURCE_B = { id: 2, propertyId: 1, url: 'http://booking/ical', platformKey: 'booking', platformLabel: 'Booking', name: 'Booking' };

function fresh() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, defaultCheckIn, defaultCheckOut, defaultCautionAmount) VALUES (1, '15:00', '10:00', 500)").run();
  db.prepare("INSERT INTO ical_sources (id, propertyId, name, platformKey, platformLabel) VALUES (1, 1, 'Airbnb', 'airbnb', 'Airbnb'), (2, 1, 'Booking', 'booking', 'Booking')").run();
  return { db, model: propertyIcalModel.buildModel(db) };
}
const resCount = (db) => db.prepare('SELECT COUNT(*) c FROM reservations').get().c;

const origFetch = global.fetch;
test.afterEach(() => { global.fetch = origFetch; });

test('(a) re-importing the same feed does not overwrite — unchanged is a no-op', async () => {
  const { db, model } = fresh();
  stubFetch([{ uid: 'A1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(SOURCE_A);
  const r2 = await model.syncSource(SOURCE_A);
  assert.equal(r2.unchangedCount, 1);
  assert.equal(r2.updatedCount, 0);
  assert.equal(resCount(db), 1);
  assert.equal(db.prepare('SELECT endDate FROM reservations').get().endDate, '2026-07-13'); // data untouched
});

test('(a) a user-modified (locked) reservation is never overwritten by re-import', async () => {
  const { db, model } = fresh();
  stubFetch([{ uid: 'A1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(SOURCE_A);
  db.prepare("UPDATE reservations SET icalSyncLocked = 1").run();
  stubFetch([{ uid: 'A1', start: '20260710', end: '20260720', summary: 'Jean Dupont' }]); // changed dates
  const r = await model.syncSource(SOURCE_A);
  assert.equal(r.lockedCount, 1);
  assert.equal(r.updatedCount, 0);
  assert.equal(db.prepare('SELECT endDate FROM reservations').get().endDate, '2026-07-13'); // unchanged
});

test('(b) same dates + same name, different UID (same platform) → same reservation, no duplicate', async () => {
  const { db, model } = fresh();
  stubFetch([{ uid: 'A1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(SOURCE_A);
  const originalId = db.prepare('SELECT id FROM reservations').get().id;
  // Same booking, platform re-issued the UID.
  stubFetch([{ uid: 'A2-new', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(SOURCE_A);
  assert.equal(resCount(db), 1);
  assert.equal(db.prepare('SELECT id FROM reservations').get().id, originalId);
});

test('(c) same dates + same name from a DIFFERENT platform → same reservation, no duplicate', async () => {
  const { db, model } = fresh();
  stubFetch([{ uid: 'A1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(SOURCE_A);
  const originalId = db.prepare('SELECT id FROM reservations').get().id;
  // The same booking also appears in a second platform's feed (different source + UID).
  stubFetch([{ uid: 'B1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(SOURCE_B);
  assert.equal(resCount(db), 1, 'cross-platform duplicate must map to the existing reservation');
  assert.equal(db.prepare('SELECT id FROM reservations').get().id, originalId);
});

test('(c) cross-platform match never overwrites a locked reservation', async () => {
  const { db, model } = fresh();
  stubFetch([{ uid: 'A1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(SOURCE_A);
  db.prepare('UPDATE reservations SET icalSyncLocked = 1').run();
  // Same dates + name (so it's matched cross-platform) but different details (description → hash differs):
  // the match is found, yet the locked reservation must not be overwritten.
  stubFetch([{ uid: 'B1', start: '20260710', end: '20260713', summary: 'Jean Dupont', description: 'Booking ref 9988' }]);
  const r = await model.syncSource(SOURCE_B);
  assert.equal(resCount(db), 1);
  assert.equal(r.lockedCount, 1);
  assert.equal(db.prepare('SELECT endDate FROM reservations').get().endDate, '2026-07-13'); // not overwritten
});

test('legacy match is robust to notes drift via the authoritative icalOriginalSummary column', async () => {
  const { db, model } = fresh();
  stubFetch([{ uid: 'A1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(SOURCE_A);
  const originalId = db.prepare('SELECT id FROM reservations').get().id;
  assert.equal(db.prepare('SELECT icalOriginalSummary FROM reservations').get().icalOriginalSummary, 'Jean Dupont');

  // The user renamed the client and the notes drifted (here the "Résumé" line is deliberately wrong),
  // and the per-source mapping is gone (a legacy / pre-column reservation). The ONLY trustworthy trace
  // of the original guest name is the icalOriginalSummary column.
  db.prepare('UPDATE reservations SET notes = ? WHERE id = ?')
    .run('Import iCal (Airbnb)\nUID: A1\nRésumé: Nom Modifié', originalId);
  db.prepare('DELETE FROM ical_import_events WHERE sourceId = 1').run();

  // Re-import the same booking → the date-scan legacy path must re-attach to the existing reservation
  // via icalOriginalSummary (the misleading notes parse alone would miss → a duplicate).
  stubFetch([{ uid: 'A1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(SOURCE_A);
  assert.equal(resCount(db), 1, 'must re-attach via icalOriginalSummary despite drifted notes');
  assert.equal(db.prepare('SELECT id FROM reservations').get().id, originalId);
});

test('cross-platform shared reservation survives until BOTH feeds drop it', async () => {
  const { db, model } = fresh();
  stubFetch([{ uid: 'A1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(SOURCE_A);
  stubFetch([{ uid: 'B1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(SOURCE_B); // both sources now map to the one reservation

  // Source A drops the booking — but Booking still lists it → reservation must survive.
  stubFetch([]);
  await model.syncSource(SOURCE_A);
  assert.equal(resCount(db), 1, 'reservation still referenced by the other platform');

  // Now Booking drops it too → reservation removed.
  stubFetch([]);
  await model.syncSource(SOURCE_B);
  assert.equal(resCount(db), 0);
});
