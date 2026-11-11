// specs/ical-sync-mapping-resilience.md rule 8 (audit R5-1) — an observation older than one already applied
// is dropped, and two empty answers confirm each other only when the second fetch started after the first
// completed. syncMany prefetches every feed at t0 but applies them one after the other, so a feed can reach
// its turn after a fresher operator sync of the same source.
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

const streakOf = (db) => db.prepare('SELECT emptyFeedStreak s FROM ical_sources WHERE id = 2').get().s;
const resCount = (db) => db.prepare('SELECT COUNT(*) c FROM reservations').get().c;
const mappingCount = (db) => db.prepare('SELECT COUNT(*) c FROM ical_import_events').get().c;

const EMPTY = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';
const openAlerts = (db) => db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts WHERE acknowledgedAt IS NULL').get().c;


const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const gdfSource = (db) => db.prepare('SELECT * FROM ical_sources WHERE id = 2').get();
const allSources = (db) => db.prepare('SELECT * FROM ical_sources WHERE isActive = 1 ORDER BY id').all();

function slowThen(gdfBody) {
  global.fetch = async (url) => {
    if (String(url).includes('slow')) { await wait(300); return { ok: true, text: async () => icsFeed([]) }; }
    return { ok: true, text: async () => gdfBody() };
  };
}

test('rule 8: a feed prefetched during an outage is not a second observation after the operator already saw it', async () => {
  const { db, model } = freshModel();
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  const good = icsFeed([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]);
  stubFetchBody(good);
  await model.syncSourceAndRecord(gdfSource(db));
  let body = EMPTY;
  slowThen(() => body);
  const auto = model.syncMany(allSources(db));
  await wait(50);
  const op = await model.syncOne(1, 2);
  assert.ok(op.error, 'the operator sync of the first empty answer is refused');
  assert.equal(streakOf(db), 1);
  body = good;
  await auto;
  assert.equal(mappingCount(db), 1, 'mappings kept');
  assert.equal(openAlerts(db), 0);
  assert.equal(streakOf(db), 1, 'the stale empty observation was not counted');
});

test('rule 8: an older prefetched feed does not flag a booking the operator sync just created', async () => {
  const { db, model } = freshModel();
  const a = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  const x = { start: isoOffset(40).compact, end: isoOffset(43).compact };
  const oldFeed = icsFeed([{ uid: 'GDF1', start: a.start, end: a.end, summary: 'BOOKED' }]);
  const newFeed = icsFeed([{ uid: 'GDF1', start: a.start, end: a.end, summary: 'BOOKED' }, { uid: 'GDFX', start: x.start, end: x.end, summary: 'BOOKED' }]);
  stubFetchBody(oldFeed);
  await model.syncSourceAndRecord(gdfSource(db));
  let body = oldFeed;
  slowThen(() => body);
  const auto = model.syncMany(allSources(db));
  await wait(20);
  body = newFeed;
  const op = await model.syncOne(1, 2);
  assert.equal(op.data.createdCount, 1);
  const res = await auto;
  assert.equal(res[1].skipped, 'newer sync applied');
  assert.equal(openAlerts(db), 0, 'the new booking is not offered for cancellation');
  assert.equal(mappingCount(db), 2);
});

test('rule 8: a skipped stale observation leaves the source status row untouched', async () => {
  const { db, model } = freshModel();
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  const feed = icsFeed([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]);
  stubFetchBody(feed);
  await model.syncSourceAndRecord(gdfSource(db));
  slowThen(() => feed);
  const auto = model.syncMany(allSources(db));
  await wait(20);
  await model.syncOne(1, 2);
  const before = db.prepare('SELECT lastSyncAt, lastSyncCounts FROM ical_sources WHERE id = 2').get();
  await auto;
  assert.deepEqual(db.prepare('SELECT lastSyncAt, lastSyncCounts FROM ical_sources WHERE id = 2').get(), before);
});

test('rule 8: two sequential empty answers still confirm each other', async () => {
  const { db, model } = freshModel();
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetchBody(icsFeed([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]));
  await model.syncSourceAndRecord(gdfSource(db));
  stubFetchBody(EMPTY);
  await assert.rejects(model.syncSourceAndRecord(gdfSource(db)));
  await model.syncSourceAndRecord(gdfSource(db));
  assert.equal(streakOf(db), 2);
  assert.equal(openAlerts(db), 1);
});

test('rule 8: a normal syncMany pass applies every source', async () => {
  const { db, model } = freshModel();
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetchBody(icsFeed([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]));
  const res = await model.syncMany(allSources(db));
  assert.deepEqual(res.map((r) => r.ok), [true, true]);
  assert.ok(!res[1].skipped);
});

test('rule 8: a stale prefetch that failed neither resets the streak nor writes an error status', async () => {
  const { db, model } = freshModel();
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  const good = icsFeed([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]);
  stubFetchBody(good);
  await model.syncSourceAndRecord(gdfSource(db));
  global.fetch = async (url) => {
    if (String(url).includes('slow')) { await wait(300); return { ok: true, text: async () => icsFeed([]) }; }
    return { ok: false, status: 503, text: async () => '' };
  };
  const auto = model.syncMany(allSources(db));
  await wait(20);
  stubFetchBody(EMPTY);
  const op = await model.syncOne(1, 2);
  assert.ok(op.error);
  assert.equal(streakOf(db), 1);
  const before = db.prepare('SELECT lastSyncStatus, lastSyncMessage FROM ical_sources WHERE id = 2').get();
  const res = await auto;
  assert.equal(res[1].skipped, 'newer sync applied');
  assert.equal(streakOf(db), 1, 'the stale failure reset the streak');
  assert.deepEqual(db.prepare('SELECT lastSyncStatus, lastSyncMessage FROM ical_sources WHERE id = 2').get(), before);
});
