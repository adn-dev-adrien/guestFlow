const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const propertyIcalModel = require('../models/propertyIcalModel');

// Guards the closure-overlap contract on the iCal sync (Adrien 2026-06-06).
// Until this guard landed, `propertyIcalModel.syncSource` called the prepared INSERT
// directly — bypassing `validateAvailability` — so a remote platform could override
// an operator-declared establishment closure with a new reservation. The guard fires
// `findCoveringClosure` on every event before any insert/update, and silently drops
// the event when a closure covers its date range.

const DDL = `
  CREATE TABLE properties (
    id INTEGER PRIMARY KEY, name TEXT, defaultCheckIn TEXT, defaultCheckOut TEXT, defaultCautionAmount REAL
  );
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
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL,
    previousStartDate TEXT NOT NULL, previousEndDate TEXT NOT NULL,
    newStartDate TEXT NOT NULL, newEndDate TEXT NOT NULL,
    detectedAt TEXT NOT NULL DEFAULT (datetime('now')), acknowledgedAt TEXT, outcome TEXT
  );
  CREATE TABLE ical_cancellation_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL,
    sourceId INTEGER NOT NULL, eventUid TEXT NOT NULL,
    detectedAt TEXT NOT NULL DEFAULT (datetime('now')), acknowledgedAt TEXT, outcome TEXT
  );
  CREATE TABLE establishment_closures (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER,
    label TEXT NOT NULL DEFAULT 'Fermeture établissement',
    startDate TEXT NOT NULL, endDate TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
  );
`;

function icsFeed(events) {
  const lines = ['BEGIN:VCALENDAR'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTART;VALUE=DATE:${e.start}`,
      `DTEND;VALUE=DATE:${e.end}`,
      `SUMMARY:${e.summary || 'Booking'}`,
      'END:VEVENT',
    );
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
  db.prepare("INSERT INTO properties (id, name, defaultCheckIn, defaultCheckOut, defaultCautionAmount) VALUES (1, 'Gîte', '15:00', '10:00', 500)").run();
  const model = propertyIcalModel.buildModel(db);
  const source = { id: 1, propertyId: 1, url: 'http://feed.test/ical', platformKey: 'airbnb', platformLabel: 'Airbnb', name: 'Airbnb' };
  return { db, model, source };
}

const origFetch = global.fetch;
test.afterEach(() => { global.fetch = origFetch; });

// ─────────────────────────────────────────────────────────────────────────────────────────

test('iCal event overlapping a property closure → skipped, no reservation created, counter bumped', () => {
  const { db, model, source } = freshModel();
  // Declared closure on the property for the week of 2026-07-13.
  db.prepare(
    "INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (1, 'Vacances été', '2026-07-13', '2026-07-20')",
  ).run();
  // iCal feed: a new Airbnb booking straddling the closed period.
  stubFetch([{ uid: 'evt-101', start: '20260715', end: '20260717', summary: 'Booking - Jean Dupont' }]);

  return model.syncSource(source).then((result) => {
    assert.equal(result.skippedClosureCount, 1, 'one event skipped due to closure');
    assert.equal(result.createdCount, 0, 'no reservation inserted');
    const reservations = db.prepare('SELECT * FROM reservations').all();
    assert.equal(reservations.length, 0, 'reservations table left untouched');
    // No mapping persisted either — the event is treated as if it never existed.
    const mappings = db.prepare('SELECT * FROM ical_import_events').all();
    assert.equal(mappings.length, 0);
  });
});

test('iCal event fully outside the closure → imported normally', () => {
  const { db, model, source } = freshModel();
  db.prepare(
    "INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (1, 'Vacances été', '2026-07-13', '2026-07-20')",
  ).run();
  stubFetch([{ uid: 'evt-102', start: '20260801', end: '20260805', summary: 'Booking - Jane Smith' }]);

  return model.syncSource(source).then((result) => {
    assert.equal(result.skippedClosureCount, 0);
    assert.equal(result.createdCount, 1);
    const reservations = db.prepare('SELECT startDate, endDate FROM reservations').all();
    assert.deepEqual(reservations, [{ startDate: '2026-08-01', endDate: '2026-08-05' }]);
  });
});

test('Mixed feed — overlapping events dropped, non-overlapping ones still imported in the same sync', () => {
  const { db, model, source } = freshModel();
  db.prepare(
    "INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (1, 'Vacances été', '2026-07-13', '2026-07-20')",
  ).run();
  stubFetch([
    { uid: 'evt-A', start: '20260714', end: '20260716', summary: 'Booking A (skipped)' },
    { uid: 'evt-B', start: '20260801', end: '20260805', summary: 'Booking B (imported)' },
    { uid: 'evt-C', start: '20260719', end: '20260722', summary: 'Booking C (skipped, straddles end)' },
  ]);

  return model.syncSource(source).then((result) => {
    assert.equal(result.skippedClosureCount, 2);
    assert.equal(result.createdCount, 1);
    const reservations = db.prepare('SELECT sourceIcalEventUid FROM reservations').all().map((r) => r.sourceIcalEventUid);
    assert.deepEqual(reservations, ['evt-B'], 'only the non-overlapping event landed');
  });
});

test('Global closure (propertyId IS NULL) also blocks iCal events on every property', () => {
  const { db, model, source } = freshModel();
  // Global closure — propertyId omitted.
  db.prepare(
    "INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (NULL, 'Vacances établissement', '2026-12-23', '2027-01-03')",
  ).run();
  stubFetch([{ uid: 'evt-201', start: '20261225', end: '20261228', summary: 'Booking - Noël' }]);

  return model.syncSource(source).then((result) => {
    assert.equal(result.skippedClosureCount, 1);
    assert.equal(result.createdCount, 0);
  });
});

test('"Closed Period" event (Airbnb host-block label) is dropped at parse time, regardless of any closure', () => {
  // No closure declared here — the event is filtered by `isUnavailableIcalEvent` before
  // reaching the sync engine, so it never even hits the closure guard. Pins the parse-
  // time filter contract.
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'evt-301', start: '20260601', end: '20260608', summary: 'Closed Period' }]);

  return model.syncSource(source).then((result) => {
    assert.equal(result.scannedEvents, 0, 'event filtered out at parse time');
    assert.equal(result.createdCount, 0);
    assert.equal(result.skippedClosureCount, 0, 'parse-time filter, not closure-time');
  });
});
