const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const propertyIcalModel = require('../models/propertyIcalModel');
const { globalFetch } = require('./icalFetchFixture');

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
    lastSyncAt TEXT, lastSyncStatus TEXT, lastSyncMessage TEXT, lastSyncCounts TEXT, lastImportedCount INTEGER, emptyFeedStreak INTEGER NOT NULL DEFAULT 0, createdAt TEXT, updatedAt TEXT
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
  CREATE TABLE establishment_closures (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER,
    label TEXT NOT NULL DEFAULT 'Fermeture établissement',
    startDate TEXT NOT NULL, endDate TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT, price REAL, countsAsBedLinen INTEGER DEFAULT 0);
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity INTEGER, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER);
`;

function icsFeed(events) {
  const lines = ['BEGIN:VCALENDAR'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART;VALUE=DATE:${e.start}`, `DTEND;VALUE=DATE:${e.end}`, `SUMMARY:${e.summary}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function stubFetch(events) { const body = icsFeed(events); global.fetch = async () => ({ ok: true, text: async () => body }); }

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, defaultCheckIn, defaultCheckOut, defaultCautionAmount) VALUES (1, '15:00', '10:00', 500)").run();
  db.prepare("INSERT INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel) VALUES (1, 1, 'GitesDeFrance', 'http://feed.test/ical', 'gitesdefrance', 'GitesDeFrance')").run();
  const model = propertyIcalModel.buildModel(db, { fetchImpl: globalFetch });
  const source = { id: 1, propertyId: 1, url: 'http://feed.test/ical', platformKey: 'gitesdefrance', platformLabel: 'GitesDeFrance', name: 'GitesDeFrance' };
  return { db, model, source };
}

// A future stay so the soft-cancellation flow is armed (past stays are carved out).
function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return { dash: `${y}-${m}-${day}`, compact: `${y}${m}${day}` };
}

const resCount = (db) => db.prepare('SELECT COUNT(*) c FROM reservations').get().c;

const origFetch = global.fetch;
test.afterEach(() => { global.fetch = origFetch; });

// specs/reservation-fiche-concurrency.md rule 6 (audit R2 B) — a sync that writes nothing must not
// move `updatedAt`, otherwise every open fiche is refused as stale after each 5-minute pass.
test('an identical re-sync leaves updatedAt untouched, locked or not', async () => {
  const { db, model, source } = freshModel();
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  const other = { start: isoOffset(50).compact, end: isoOffset(52).compact };
  stubFetch([
    { uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' },
    { uid: 'GDF2', start: other.start, end: other.end, summary: 'BOOKED' },
  ]);
  await model.syncSource(source);
  db.prepare("UPDATE reservations SET icalSyncLocked = 1 WHERE sourceIcalEventUid = 'GDF2'").run();
  db.prepare("UPDATE reservations SET updatedAt = '2020-01-01 00:00:00'").run();

  const result = await model.syncSource(source);
  assert.equal(result.createdCount, 0);
  const stamps = db.prepare('SELECT updatedAt u FROM reservations').all().map((r) => r.u);
  assert.deepEqual(stamps, ['2020-01-01 00:00:00', '2020-01-01 00:00:00']);
});

test('a re-sync under a NEW uid for the same stay does move updatedAt (a real write)', async () => {
  const { db, model, source } = freshModel();
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetch([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]);
  await model.syncSource(source);
  db.prepare("UPDATE reservations SET updatedAt = '2020-01-01 00:00:00'").run();
  stubFetch([{ uid: 'GDF1b', start: stay.start, end: stay.end, summary: 'BOOKED' }]);
  await model.syncSource(source);
  assert.equal(resCount(db), 1);
  assert.notEqual(db.prepare('SELECT updatedAt u FROM reservations').get().u, '2020-01-01 00:00:00');
});
