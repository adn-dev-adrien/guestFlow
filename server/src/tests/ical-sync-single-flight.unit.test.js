// specs/ical-sync-mapping-resilience.md rule 7 (audit R4-2) — one sync per source at a time. Two overlapping
// syncs of the same source (the 5-minute pass, « Synchroniser », « Synchroniser tout ») are one observation
// of the platform: a single degenerate empty answer must not be counted twice and wipe the mappings.
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

function stubFetchBody(body) {
  global.fetch = async () => ({ ok: true, text: async () => body });
}
function stubFetch(events) { stubFetchBody(icsFeed(events)); }
function stubFetchError() {
  global.fetch = async () => ({ ok: false, status: 503, text: async () => '' });
}

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

const streakOf = (db) => db.prepare('SELECT emptyFeedStreak s FROM ical_sources WHERE id = 1').get().s;
const resCount = (db) => db.prepare('SELECT COUNT(*) c FROM reservations').get().c;
const mappingCount = (db) => db.prepare('SELECT COUNT(*) c FROM ical_import_events').get().c;

const EMPTY = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';
const openAlerts = (db) => db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts WHERE acknowledgedAt IS NULL').get().c;

function armed() {
  const ctx = freshModel();
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetch([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]);
  return { ...ctx, stay };
}

test('rule 7: two overlapping syncs of one source count one empty observation', async () => {
  const { db, model, source, stay } = armed();
  await model.syncSource(source);
  stubFetchBody(EMPTY);
  const out = await Promise.allSettled([model.syncSourceAndRecord(source), model.syncSourceAndRecord(source)]);
  assert.deepEqual(out.map((o) => o.status), ['rejected', 'rejected']);
  assert.match(out[0].reason.message, /Flux vide inattendu/);
  assert.equal(streakOf(db), 1);
  assert.equal(mappingCount(db), 1);
  assert.equal(openAlerts(db), 0);
  stubFetch([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]);
  await model.syncSourceAndRecord(source);
  assert.equal(resCount(db), 1);
});

test('rule 7: the second caller joins the running sync and one fetch is made', async () => {
  const { model, source } = armed();
  await model.syncSource(source);
  let fetches = 0;
  global.fetch = async () => { fetches += 1; await new Promise((r) => setTimeout(r, 20)); return { ok: true, text: async () => EMPTY }; };
  const first = model.syncSourceAndRecord(source);
  const second = model.syncSourceAndRecord(source);
  assert.equal(first, second);
  await Promise.allSettled([first, second]);
  assert.equal(fetches, 1);
});

test('rule 7: the lock is released at the end, so two SEQUENTIAL empty answers still confirm', async () => {
  const { db, model, source } = armed();
  await model.syncSource(source);
  stubFetchBody(EMPTY);
  await model.syncSourceAndRecord(source).catch(() => {});
  assert.equal(streakOf(db), 1);
  const second = await model.syncSourceAndRecord(source);
  assert.equal(second.removedCount, 1);
  assert.equal(streakOf(db), 2);
});

test('rule 7: syncOne and syncAllForProperty racing on a source share one run', async () => {
  const { db, model, source } = armed();
  await model.syncSource(source);
  stubFetchBody(EMPTY);
  const [one, all] = await Promise.all([model.syncOne(1, 1), model.syncAllForProperty(1)]);
  assert.ok(one.error);
  assert.equal(all.results[0].ok, false);
  assert.equal(streakOf(db), 1);
  assert.equal(mappingCount(db), 1);
});

test('rule 7: a failed sync releases the source for the next caller', async () => {
  const { model, source } = armed();
  stubFetchError();
  await assert.rejects(model.syncSourceAndRecord(source));
  stubFetch([]);
  await model.syncSourceAndRecord(source);
});
