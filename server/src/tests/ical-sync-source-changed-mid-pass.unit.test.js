// specs/ical-import-hardening.md rule 20 (audit R6-1) — a pass already in flight must not apply a feed to a
// source the operator has stopped, deleted or re-pointed since the pass read its rows.
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
  db.prepare("INSERT INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel) VALUES (1, 1, 'Slow', 'http://slow.test/ical', 'abritel', 'Slow')").run();
  db.prepare("INSERT INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel) VALUES (2, 1, 'GitesDeFrance', 'http://feed.test/ical', 'gitesdefrance', 'GitesDeFrance')").run();
  const model = propertyIcalModel.buildModel(db, { fetchImpl: globalFetch });
  const source = { id: 2, propertyId: 1, url: 'http://feed.test/ical', platformKey: 'gitesdefrance', platformLabel: 'GitesDeFrance', name: 'GitesDeFrance' };
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const gdfSource = (db) => db.prepare('SELECT * FROM ical_sources WHERE id = 2').get();
const allSources = (db) => db.prepare('SELECT * FROM ical_sources WHERE isActive = 1 ORDER BY id').all();
const statusOf = (db) => db.prepare('SELECT lastSyncAt, lastSyncStatus, lastSyncMessage FROM ical_sources WHERE id = 2').get();

function slowThen(gdfBody) {
  global.fetch = async (url) => {
    if (String(url).includes('slow')) { await wait(300); return { ok: true, text: async () => icsFeed([]) }; }
    return { ok: true, text: async () => gdfBody() };
  };
}

test('rule 20: a source stopped while a pass is in flight is not applied by that pass', async () => {
  const { db, model } = freshModel();
  const a = isoOffset(30), b = isoOffset(33);
  const feed = () => icsFeed([{ uid: 'A', start: a.compact, end: b.compact, summary: 'Alpha' }]);
  stubFetchBody(feed());
  await model.syncSourceAndRecord(gdfSource(db));
  assert.equal(resCount(db), 1);
  const statusBefore = statusOf(db);
  slowThen(feed);
  const pass = model.syncMany(allSources(db));
  await wait(50);
  db.prepare('UPDATE ical_sources SET isActive = 0 WHERE id = 2').run();
  const rid = db.prepare('SELECT id FROM reservations').get().id;
  db.prepare('DELETE FROM ical_import_events WHERE reservationId = ?').run(rid);
  db.prepare('DELETE FROM reservations WHERE id = ?').run(rid);
  const results = await pass;
  assert.equal(resCount(db), 0, 'the deleted stay must not come back');
  assert.ok(results.find((r) => r.sourceId === 2).skipped);
  assert.deepEqual(statusOf(db), statusBefore, 'no status write for a skipped source');
});

test('rule 20: a source whose URL is corrected mid-pass does not apply the old URL feed', async () => {
  const { db, model } = freshModel();
  const a = isoOffset(30), b = isoOffset(33);
  global.fetch = async (url) => {
    if (String(url).includes('slow')) { await wait(300); return { ok: true, text: async () => icsFeed([]) }; }
    if (String(url).includes('wrong')) return { ok: true, text: async () => icsFeed([{ uid: 'W', start: a.compact, end: b.compact, summary: 'Wrong property guest' }]) };
    return { ok: true, text: async () => icsFeed([]) };
  };
  db.prepare("UPDATE ical_sources SET url='http://wrong.test/ical' WHERE id=2").run();
  const pass = model.syncMany(allSources(db));
  await wait(50);
  db.prepare("UPDATE ical_sources SET url='http://feed.test/ical' WHERE id=2").run();
  const results = await pass;
  assert.equal(resCount(db), 0);
  assert.ok(results.find((r) => r.sourceId === 2).skipped);
});

test('rule 20: a source deleted mid-pass is skipped, not reported as an error', async () => {
  const { db, model } = freshModel();
  const a = isoOffset(30), b = isoOffset(33);
  slowThen(() => icsFeed([{ uid: 'A', start: a.compact, end: b.compact, summary: 'Alpha' }]));
  const pass = model.syncMany(allSources(db));
  await wait(50);
  db.prepare('DELETE FROM ical_sources WHERE id = 2').run();
  const results = await pass;
  assert.equal(resCount(db), 0);
  assert.ok(results.find((r) => r.sourceId === 2).skipped);
});

test('rule 20: an untouched active source is still applied by the pass', async () => {
  const { db, model } = freshModel();
  const a = isoOffset(30), b = isoOffset(33);
  slowThen(() => icsFeed([{ uid: 'A', start: a.compact, end: b.compact, summary: 'Alpha' }]));
  await model.syncMany(allSources(db));
  assert.equal(resCount(db), 1);
});
