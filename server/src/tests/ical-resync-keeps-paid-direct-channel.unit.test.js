// specs/ical-sync-override-locked-dates.md rule 12 + reservation-save-keeps-pricing.md rule 20 — audit R4 re-review:
// the iCal resync of a never-edited stay rewrites its platform, which must not turn a direct stay with a ticked
// acompte or solde into a platform stay (Adrien, 2026-10-29); the rest of the sync still applies.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const propertyIcalModel = require('../models/propertyIcalModel');
const { globalFetch } = require('./icalFetchFixture');
const { setDirectChannels } = require('../utils/platformNameFormat');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, defaultCheckIn TEXT, defaultCheckOut TEXT, defaultCautionAmount REAL);
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, notes TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT DEFAULT 'reservation', propertyId INTEGER, clientId INTEGER,
    startDate TEXT, endDate TEXT, adults INTEGER, children INTEGER, teens INTEGER, babies INTEGER,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER, checkInTime TEXT, checkOutTime TEXT,
    platform TEXT, totalPrice REAL, discountPercent REAL, finalPrice REAL,
    depositAmount REAL, depositDueDate TEXT, depositPaid INTEGER, depositPaidCash INTEGER DEFAULT 0,
    balanceAmount REAL, balanceDueDate TEXT, balancePaid INTEGER, balancePaidCash INTEGER DEFAULT 0,
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
  CREATE TABLE ical_date_drift_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, previousStartDate TEXT NOT NULL, previousEndDate TEXT NOT NULL, newStartDate TEXT NOT NULL, newEndDate TEXT NOT NULL, detectedAt TEXT NOT NULL DEFAULT (datetime('now')), acknowledgedAt TEXT, outcome TEXT);
  CREATE TABLE ical_cancellation_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, sourceId INTEGER NOT NULL, eventUid TEXT NOT NULL, detectedAt TEXT NOT NULL DEFAULT (datetime('now')), acknowledgedAt TEXT, outcome TEXT);
  CREATE TABLE ical_export_ranges (propertyId INTEGER NOT NULL, startDate TEXT NOT NULL, endDate TEXT NOT NULL, sourceIcalSourceId INTEGER, PRIMARY KEY (propertyId, startDate, endDate));
  CREATE TABLE ical_export_tombstones (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER NOT NULL, startDate TEXT NOT NULL, endDate TEXT NOT NULL,
    removedAt TEXT NOT NULL DEFAULT (datetime('now')), sourceIcalSourceId INTEGER
  );
  CREATE TABLE ical_superseded_events (
    sourceId INTEGER NOT NULL, eventUid TEXT NOT NULL, reservationId INTEGER NOT NULL, supersededBySourceId INTEGER NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (sourceId, eventUid)
  );
  CREATE TABLE establishment_closures (id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, label TEXT NOT NULL DEFAULT 'Fermeture établissement', startDate TEXT NOT NULL, endDate TEXT NOT NULL, createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now')));
  CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT, price REAL, countsAsBedLinen INTEGER DEFAULT 0);
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
  CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity INTEGER, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER);
`;

function feed(events) {
  const lines = ['BEGIN:VCALENDAR'];
  for (const e of events) lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART;VALUE=DATE:${e.start}`, `DTEND;VALUE=DATE:${e.end}`, 'SUMMARY:BOOKED', 'END:VEVENT');
  lines.push('END:VCALENDAR');
  const body = lines.join('\r\n');
  global.fetch = async () => ({ ok: true, text: async () => body });
}
const ymd = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
const dash = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;

async function syncedStay(ticked) {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, defaultCheckIn, defaultCheckOut, defaultCautionAmount) VALUES (1, '15:00', '10:00', 500)").run();
  db.prepare("INSERT INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel) VALUES (1, 1, 'Booking', 'http://feed.test/ical', 'booking', 'Booking')").run();
  const model = propertyIcalModel.buildModel(db, { fetchImpl: globalFetch });
  const source = { id: 1, propertyId: 1, url: 'http://feed.test/ical', platformKey: 'booking', platformLabel: 'Booking', name: 'Booking' };
  feed([{ uid: 'E1', start: ymd(30), end: ymd(33) }]);
  await model.syncSource(source);
  db.prepare(`UPDATE reservations SET platform = 'Lodgify', ${ticked ? 'balancePaid = 1,' : ''} updatedAt = '2020-01-01 00:00:00'`).run();
  return { db, model, source };
}

test.beforeEach(() => setDirectChannels(['Lodgify']));
test.afterEach(() => setDirectChannels([]));

test('rule 12 — a resync that moves the dates keeps the direct channel of a stay with a ticked solde', async () => {
  const { db, model, source } = await syncedStay(true);
  feed([{ uid: 'E1', start: ymd(30), end: ymd(34) }]);
  await model.syncSource(source);
  const row = db.prepare('SELECT platform, endDate FROM reservations').get();
  assert.equal(row.platform, 'Lodgify');
  assert.equal(row.endDate, dash(ymd(34)), 'the rest of the sync still applies');
});

test('rule 12 — with a cash acompte ticked as well', async () => {
  const { db, model, source } = await syncedStay(false);
  db.prepare('UPDATE reservations SET depositPaidCash = 1').run();
  feed([{ uid: 'E1', start: ymd(30), end: ymd(34) }]);
  await model.syncSource(source);
  assert.equal(db.prepare('SELECT platform FROM reservations').get().platform, 'Lodgify');
});

test('rule 12 — with no payment ticked the platform is rewritten as before', async () => {
  const { db, model, source } = await syncedStay(false);
  feed([{ uid: 'E1', start: ymd(30), end: ymd(34) }]);
  await model.syncSource(source);
  assert.equal(db.prepare('SELECT platform FROM reservations').get().platform, 'Booking');
});
