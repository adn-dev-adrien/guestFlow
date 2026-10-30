// specs/lodgify-decommission.md §3 rules 14 and 15 — a tombstone never covers the source that owned
// the stay, and a stay re-claimed under a new UID drops its pending cancellation alert.
// Incident of 2026-10-22: a Booking stay cancelled then re-booked on the same nights (same UID) was
// skipped as an echo of its own tombstone, leaving its nights open to every other channel.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const propertyIcalModel = require('../models/propertyIcalModel');
const { globalFetch } = require('./icalFetchFixture');
const icalExportRangesModel = require('../models/icalExportRangesModel');
const icalCancellationModel = require('../models/icalCancellationModel');
const { mergePlatformDuplicates } = require('../utils/platformMerge');
const { localIsoDate } = require('../utils/localDate');

// Every date is relative to the clock: a cancellation alert is only raised for a stay still to come,
// so a literal date would turn this suite red the day it passes.
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localIsoDate(d); };
const compact = (iso) => iso.replace(/-/g, '');
const S = inDays(60);
const E = inDays(62);

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, defaultCheckIn TEXT, defaultCheckOut TEXT, defaultCautionAmount REAL);
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, notes TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, clientId INTEGER,
    startDate TEXT, endDate TEXT, adults INTEGER, children INTEGER, teens INTEGER, babies INTEGER,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER, checkInTime TEXT, checkOutTime TEXT,
    platform TEXT, totalPrice REAL, discountPercent REAL, finalPrice REAL,
    depositAmount REAL, depositDueDate TEXT, depositPaid INTEGER,
    balanceAmount REAL, balanceDueDate TEXT, balancePaid INTEGER,
    sourceType TEXT, sourcePlatformKey TEXT, sourceIcalSourceId INTEGER, sourceIcalEventUid TEXT, icalSyncLocked INTEGER,
    notes TEXT, cautionAmount REAL, icalOriginalSummary TEXT, updatedAt TEXT,
    kind TEXT NOT NULL DEFAULT 'reservation', bookingConflictAt TEXT
  );
  CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER, name TEXT, url TEXT, isActive INTEGER DEFAULT 1, platformKey TEXT, platformLabel TEXT, emptyFeedStreak INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE ical_import_events (
    sourceId INTEGER, eventUid TEXT, reservationId INTEGER, eventHash TEXT,
    startDate TEXT, endDate TEXT, summaryNormalized TEXT, lastSeenAt TEXT,
    UNIQUE(sourceId, eventUid)
  );
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT);
  CREATE TABLE ical_date_drift_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL,
    previousStartDate TEXT NOT NULL, previousEndDate TEXT NOT NULL, newStartDate TEXT NOT NULL, newEndDate TEXT NOT NULL,
    detectedAt TEXT NOT NULL DEFAULT (datetime('now')), acknowledgedAt TEXT, outcome TEXT
  );
  CREATE TABLE ical_cancellation_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, sourceId INTEGER NOT NULL, eventUid TEXT NOT NULL,
    detectedAt TEXT NOT NULL DEFAULT (datetime('now')), acknowledgedAt TEXT, outcome TEXT
  );
  CREATE TABLE establishment_closures (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER,
    label TEXT NOT NULL DEFAULT 'Fermeture établissement',
    startDate TEXT NOT NULL, endDate TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE ical_export_ranges (propertyId INTEGER NOT NULL, startDate TEXT NOT NULL, endDate TEXT NOT NULL, sourceIcalSourceId INTEGER, PRIMARY KEY (propertyId, startDate, endDate));
  CREATE TABLE ical_export_tombstones (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER NOT NULL, startDate TEXT NOT NULL, endDate TEXT NOT NULL,
    removedAt TEXT NOT NULL DEFAULT (datetime('now')), sourceIcalSourceId INTEGER
  );
  CREATE TABLE ical_superseded_events (
    sourceId INTEGER NOT NULL, eventUid TEXT NOT NULL, reservationId INTEGER NOT NULL, supersededBySourceId INTEGER NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (sourceId, eventUid)
  );
`;

const BOOKING = { id: 12, propertyId: 1, url: 'http://booking/ical', platformKey: 'booking', platformLabel: 'Booking', name: 'Booking' };
const GREENGO = { id: 7, propertyId: 1, url: 'http://greengo/ical', platformKey: 'greengo', platformLabel: 'Greengo', name: 'Greengo' };
const LODGIFY = { id: 10, propertyId: 1, url: 'http://lodgify/ical', platformKey: 'lodgify', platformLabel: 'Lodgify', name: 'Lodgify' };

function icsFeed(events) {
  const lines = ['BEGIN:VCALENDAR'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART;VALUE=DATE:${e.start}`, `DTEND;VALUE=DATE:${e.end}`, `SUMMARY:${e.summary}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function stubFetch(events) { global.fetch = async () => ({ ok: true, text: async () => icsFeed(events) }); }
const closed = (uid, start, end) => ({ uid, start, end, summary: 'CLOSED - Not available' });

// A Booking stay that stays in the feed throughout, so removing the incident's stay never trips the
// empty-feed guard.
const ANCHOR = closed('anchor@booking.com', compact(inDays(220)), compact(inDays(222)));
const STAY = closed('7ab42760@booking.com', compact(S), compact(E));

function fresh() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name, defaultCheckIn, defaultCheckOut, defaultCautionAmount) VALUES (1, 'Gite', '15:00', '10:00', 0)").run();
  const insertSource = db.prepare('INSERT INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel) VALUES (?, 1, ?, ?, ?, ?)');
  for (const s of [BOOKING, GREENGO, LODGIFY]) insertSource.run(s.id, s.name, s.url, s.platformKey, s.platformLabel);
  return { db, model: propertyIcalModel.buildModel(db, { fetchImpl: globalFetch }), ranges: icalExportRangesModel.create(db) };
}
const stayOn = (db, startDate) => db.prepare("SELECT * FROM reservations WHERE startDate = ? AND kind = 'reservation'").all(startDate);

// Booking stay imported → leaves the feed → the operator approves the cancellation alert.
async function cancelBookingStay(db, model) {
  stubFetch([ANCHOR, STAY]);
  await model.syncSource(BOOKING);
  assert.equal(stayOn(db, S).length, 1);
  stubFetch([ANCHOR]);
  await model.syncSource(BOOKING);
  const alert = db.prepare('SELECT id FROM ical_cancellation_alerts WHERE eventUid = ?').get(STAY.uid);
  assert.ok(alert, 'the vanished Booking stay raises a cancellation alert');
  icalCancellationModel.buildModel(db).approve(alert.id);
  assert.equal(stayOn(db, S).length, 0, 'approving deletes the fiche');
}

const origFetch = global.fetch;
test.afterEach(() => { global.fetch = origFetch; });

test('rule 14 — the snapshot and its tombstone record the owner source; a range shared by two origins has none', () => {
  const { db, ranges } = fresh();
  db.prepare(`INSERT INTO reservations (id, propertyId, startDate, endDate, sourceIcalSourceId) VALUES
    (1, 1, '${inDays(250)}', '${inDays(252)}', 12),
    (2, 1, '${inDays(280)}', '${inDays(282)}', 7), (3, 1, '${inDays(280)}', '${inDays(282)}', NULL)`).run();
  ranges.refresh(1);
  const owners = db.prepare('SELECT startDate, sourceIcalSourceId FROM ical_export_ranges ORDER BY startDate').all();
  assert.deepEqual(owners.map((r) => r.sourceIcalSourceId), [12, null]);

  db.prepare('DELETE FROM reservations').run();
  assert.equal(ranges.refresh(1), 2);
  const tombs = db.prepare('SELECT startDate, sourceIcalSourceId FROM ical_export_tombstones ORDER BY startDate').all();
  assert.deepEqual(tombs.map((r) => r.sourceIcalSourceId), [12, null]);
  assert.equal(ranges.listActiveTombstones(1, undefined, { excludeSourceId: 12 }).length, 1);
  assert.equal(ranges.listActiveTombstones(1).length, 2, 'without an exclusion every tombstone covers');
});

test('rule 14 — the incident: a cancelled Booking stay re-booked with the same UID is created, not skipped as an echo', async () => {
  const { db, model } = fresh();
  await cancelBookingStay(db, model);

  stubFetch([ANCHOR, STAY]);
  const r = await model.syncSource(BOOKING);
  assert.equal(r.createdCount, 1);
  const [resa] = stayOn(db, S);
  assert.equal(resa.sourceIcalSourceId, 12);
  assert.equal(resa.sourceIcalEventUid, STAY.uid);
  assert.equal(db.prepare('SELECT sourceIcalSourceId FROM ical_export_tombstones').get().sourceIcalSourceId, 12);
});

test('rule 14 — re-booked under a new UID, it is created too', async () => {
  const { db, model } = fresh();
  await cancelBookingStay(db, model);

  stubFetch([ANCHOR, closed('new-uid@booking.com', compact(S), compact(E))]);
  const r = await model.syncSource(BOOKING);
  assert.equal(stayOn(db, S).length, 1);
});

test('rule 14 — a cancelled GreenGo stay still covers the dates for 72 h: the Booking stay is created and flagged', async () => {
  const { db, model, ranges } = fresh();
  db.prepare(`INSERT INTO reservations (id, propertyId, startDate, endDate, platform, sourceType, sourceIcalSourceId) VALUES (50, 1, '${S}', '${E}', 'Greengo', 'ical', 7)`).run();
  ranges.refresh(1);
  db.prepare('DELETE FROM reservations WHERE id = 50').run();

  stubFetch([closed('ghost@booking.com', compact(S), compact(E))]);
  const r = await model.syncSource(BOOKING);
  assert.equal(r.createdCount, 1);
  assert.equal(r.conflictReservationIds.length, 1);
});

test('rule 14 — a deleted hand-entered stay (no owner) still covers the dates: created and flagged', async () => {
  const { db, model, ranges } = fresh();
  db.prepare(`INSERT INTO reservations (id, propertyId, startDate, endDate, platform, sourceType) VALUES (51, 1, '${S}', '${E}', 'Direct', 'manual')`).run();
  ranges.refresh(1);
  db.prepare('DELETE FROM reservations WHERE id = 51').run();

  stubFetch([closed('ghost@booking.com', compact(S), compact(E))]);
  const r = await model.syncSource(BOOKING);
  assert.equal(r.createdCount, 1);
  assert.equal(r.conflictReservationIds.length, 1);
});

test('rule 14 — a tombstone written before the upgrade (no owner) keeps covering, as before', async () => {
  const { db, model } = fresh();
  db.prepare(`INSERT INTO ical_export_tombstones (propertyId, startDate, endDate) VALUES (1, '${S}', '${E}')`).run();

  stubFetch([STAY]);
  const r = await model.syncSource(BOOKING);
  assert.equal(r.createdCount, 1);
  assert.equal(r.conflictReservationIds.length, 1);
});

test('rule 14 — a stay taken over by Booking then cancelled leaves a tombstone under Booking, even before the export is served again', async () => {
  const { db, model, ranges } = fresh();
  // Imported through the Lodgify relay, labelled Booking, and already published by the export.
  stubFetch([{ uid: 'L1', start: compact(S), end: compact(E), summary: 'Closed' }]);
  await model.syncSource(LODGIFY);
  db.prepare("UPDATE reservations SET platform = 'Booking'").run();
  ranges.refresh(1);
  assert.equal(db.prepare('SELECT sourceIcalSourceId FROM ical_export_ranges').get().sourceIcalSourceId, 10);

  stubFetch([ANCHOR, STAY]);
  const r = await model.syncSource(BOOKING);
  assert.equal(r.takenOverCount, 1);
  assert.equal(db.prepare(`SELECT sourceIcalSourceId FROM ical_export_ranges WHERE startDate = '${S}'`).get().sourceIcalSourceId, 12,
    'the snapshot follows the takeover at once');

  stubFetch([ANCHOR]);
  await model.syncSource(BOOKING);
  const alert = db.prepare('SELECT id FROM ical_cancellation_alerts WHERE eventUid = ?').get(STAY.uid);
  icalCancellationModel.buildModel(db).approve(alert.id);

  stubFetch([ANCHOR, STAY]);
  const back = await model.syncSource(BOOKING);
  assert.equal(stayOn(db, S).length, 1);
});

test('rule 14 — merging two sources moves the export owners to the survivor', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, platform TEXT, sourceIcalSourceId INTEGER);
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER, url TEXT, platformKey TEXT, platformLabel TEXT, name TEXT);
    CREATE TABLE ical_import_events (sourceId INTEGER, eventUid TEXT, reservationId INTEGER, UNIQUE(sourceId, eventUid));
    CREATE TABLE platforms (name TEXT UNIQUE);
    CREATE TABLE ical_export_ranges (propertyId INTEGER, startDate TEXT, endDate TEXT, sourceIcalSourceId INTEGER);
    CREATE TABLE ical_export_tombstones (id INTEGER PRIMARY KEY, propertyId INTEGER, startDate TEXT, endDate TEXT, removedAt TEXT, sourceIcalSourceId INTEGER);
    INSERT INTO ical_sources VALUES (12, 1, 'http://booking/ical', 'booking', 'Booking', 'Booking'), (13, 1, '', 'bookingcom', 'Booking.com', 'Booking.com');
    INSERT INTO ical_export_ranges VALUES (1, '${inDays(90)}', '${inDays(92)}', 13);
    INSERT INTO ical_export_tombstones VALUES (1, 1, '${S}', '${E}', datetime('now'), 13);
  `);
  mergePlatformDuplicates(db, { slugs: ['bookingcom'], targetName: 'Booking' });
  assert.equal(db.prepare('SELECT sourceIcalSourceId FROM ical_export_ranges').get().sourceIcalSourceId, 12);
  assert.equal(db.prepare('SELECT sourceIcalSourceId FROM ical_export_tombstones').get().sourceIcalSourceId, 12);
});

test('rule 15 — a stay re-booked under a new UID before the alert is handled keeps its fiche and drops the alert', async () => {
  const { db, model } = fresh();
  stubFetch([ANCHOR, STAY]);
  await model.syncSource(BOOKING);
  const [original] = stayOn(db, S);
  stubFetch([ANCHOR]);
  await model.syncSource(BOOKING);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts WHERE acknowledgedAt IS NULL').get().c, 1);

  stubFetch([ANCHOR, closed('new-uid@booking.com', compact(S), compact(E))]);
  await model.syncSource(BOOKING);
  const [kept] = stayOn(db, S);
  assert.equal(kept.id, original.id, 'the fiche is re-claimed, not duplicated');
  assert.equal(kept.sourceIcalEventUid, 'new-uid@booking.com');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts WHERE acknowledgedAt IS NULL').get().c, 0,
    'no alert is left to delete a stay that is back');
});
