const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const propertyIcalModel = require('../models/propertyIcalModel');

// Guards the iCal anti-overbooking contract: create / update / locked-skip / stale-removal /
// unavailable-filter. The sync engine was moved verbatim from routes/properties.js — this locks it in.

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
    notes TEXT, cautionAmount REAL, icalOriginalSummary TEXT, updatedAt TEXT
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
  CREATE TABLE ical_date_drift_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    previousStartDate TEXT NOT NULL,
    previousEndDate TEXT NOT NULL,
    newStartDate TEXT NOT NULL,
    newEndDate TEXT NOT NULL,
    detectedAt TEXT NOT NULL DEFAULT (datetime('now')),
    acknowledgedAt TEXT,
    outcome TEXT
  );
  CREATE TABLE ical_cancellation_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    sourceId INTEGER NOT NULL,
    eventUid TEXT NOT NULL,
    detectedAt TEXT NOT NULL DEFAULT (datetime('now')),
    acknowledgedAt TEXT,
    outcome TEXT
  );
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
  // New behavior: dates differ → a pending drift row was recorded for the Dashboard alert.
  // See specs/ical-sync-override-locked-dates.md §3 rules 1-3.
  const drifts = db.prepare('SELECT * FROM ical_date_drift_alerts WHERE acknowledgedAt IS NULL').all();
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].previousEndDate, '2026-07-13');
  assert.equal(drifts[0].newEndDate, '2026-07-20');
});

test('locked + date drift: same proposal repeated → still one pending row', async () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  db.prepare("UPDATE reservations SET icalSyncLocked = 1 WHERE sourceIcalEventUid = 'E1'").run();

  stubFetch([{ uid: 'E1', start: '20260710', end: '20260720', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  // Second sync, same dates: the mapping hash now matches → unchanged path, no new drift row.
  await model.syncSource(source);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_date_drift_alerts').get().c, 1);
});

test('locked + drift then re-drift: pending row UPDATED with the latest proposal', async () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  db.prepare("UPDATE reservations SET icalSyncLocked = 1 WHERE sourceIcalEventUid = 'E1'").run();

  stubFetch([{ uid: 'E1', start: '20260710', end: '20260720', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  // The source shuffles dates again before the user reacts.
  stubFetch([{ uid: 'E1', start: '20260712', end: '20260722', summary: 'Jean Dupont' }]);
  await model.syncSource(source);

  const drifts = db.prepare('SELECT * FROM ical_date_drift_alerts WHERE acknowledgedAt IS NULL').all();
  assert.equal(drifts.length, 1, 'still ONE pending row per reservation (rule 3)');
  // previousStart/End keep the reservation's persisted dates (the user still has those).
  assert.equal(drifts[0].previousStartDate, '2026-07-10');
  assert.equal(drifts[0].previousEndDate, '2026-07-13');
  // newStart/End reflect the LATEST proposal.
  assert.equal(drifts[0].newStartDate, '2026-07-12');
  assert.equal(drifts[0].newEndDate, '2026-07-22');
});

test('locked + summary-only change (no date diff): skipped silently, NO drift row', async () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  db.prepare("UPDATE reservations SET icalSyncLocked = 1 WHERE sourceIcalEventUid = 'E1'").run();

  // Same dates, renamed guest → hash differs but no date drift → silent skip.
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Marie Martin' }]);
  const result = await model.syncSource(source);
  assert.equal(result.lockedCount, 1);
  assert.equal(result.updatedCount, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_date_drift_alerts').get().c, 0);
});

test('unlocked + dates change: NO drift row (full update path)', async () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  // Reservation stays unlocked (icalSyncLocked = 0).

  stubFetch([{ uid: 'E1', start: '20260710', end: '20260720', summary: 'Jean Dupont' }]);
  const result = await model.syncSource(source);
  assert.equal(result.updatedCount, 1);
  assert.equal(db.prepare('SELECT endDate FROM reservations').get().endDate, '2026-07-20');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_date_drift_alerts').get().c, 0,
    'drift mechanism only triggers on locked reservations');
});

test('cancellation: an event no longer in the feed records a pending alert (soft delete)', async () => {
  // specs/ical-cancellation-approval.md §3 rule 1 — the engine no longer auto-deletes.
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  stubFetch([]);
  const result = await model.syncSource(source);
  assert.equal(result.removedCount, 1, 'removedCount counts pending cancellation alerts');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations').get().c, 1, 'reservation kept (soft flow)');
  const pending = db.prepare("SELECT reservationId, sourceId, eventUid FROM ical_cancellation_alerts WHERE acknowledgedAt IS NULL").all();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].eventUid, 'E1');
});

test('cancellation: locked reservation falls out of feed → still soft-cancelled (no lock short-circuit)', async () => {
  // The lock does NOT protect against soft cancellation; the user explicitly approves.
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  db.prepare("UPDATE reservations SET icalSyncLocked = 1 WHERE sourceIcalEventUid = 'E1'").run();
  stubFetch([]);
  await model.syncSource(source);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts WHERE acknowledgedAt IS NULL').get().c, 1);
});

test('cancellation: repeated empty-feed sync keeps ONE pending row (UPSERT)', async () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  stubFetch([]);
  await model.syncSource(source);
  await model.syncSource(source);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts').get().c, 1);
});

test('cancellation: auto-resolve when the UID reappears in the feed before the user reacts', async () => {
  // specs/ical-cancellation-approval.md §3 rule 4 — the alert is dropped silently.
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  stubFetch([]);
  await model.syncSource(source);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts WHERE acknowledgedAt IS NULL').get().c, 1);

  // The platform un-cancels: same UID is back in the feed.
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts').get().c, 0, 'pending row deleted, not acknowledged');
  // The reservation also re-acquires its mapping in the standard create/legacy-match path.
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations').get().c, 1);
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
