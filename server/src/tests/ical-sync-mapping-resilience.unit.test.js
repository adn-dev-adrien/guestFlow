const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const propertyIcalModel = require('../models/propertyIcalModel');

// specs/ical-sync-mapping-resilience.md — guards against the 2026-07-21 GdF incident:
// one degenerate empty 200 wiped every UID→reservation mapping, and the next sync
// duplicated every reservation whose icalOriginalSummary predated the column.
// Covers: step ①bis UID fallback (rules 1), well-formed ICS rejection (rule 2),
// the empty-feed streak guard (rules 3-4) and the summary self-heal (rule 5).

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
  const model = propertyIcalModel.buildModel(db);
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

// Reproduce the incident precondition: mapping memory wiped + a reservation imported before
// the icalOriginalSummary column existed (empty summary, empty notes) → every summary-based
// fallback is blind; only the UID stored on the reservation row can re-claim it.
function wipeMappingsAndSummaries(db) {
  db.prepare('DELETE FROM ical_import_events').run();
  db.prepare("UPDATE reservations SET icalOriginalSummary = NULL").run();
}

const origFetch = global.fetch;
test.afterEach(() => { global.fetch = origFetch; });

test('rule 1 — UID fallback re-claims a reservation after the mapping memory is lost (no duplicate)', async () => {
  const { db, model, source } = freshModel();
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetch([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]);
  await model.syncSource(source);
  assert.equal(resCount(db), 1);

  wipeMappingsAndSummaries(db);
  const result = await model.syncSource(source);
  assert.equal(result.createdCount, 0, 'no duplicate created');
  assert.equal(resCount(db), 1, 'the original reservation is re-claimed');
  assert.equal(mappingCount(db), 1, 'mapping rebuilt from the reservation UID');
  assert.equal(db.prepare('SELECT reservationId FROM ical_import_events').get().reservationId,
    db.prepare('SELECT id FROM reservations').get().id);
});

test('rule 1 — UID-re-claimed LOCKED reservation with changed feed dates → date-drift alert, no update', async () => {
  const { db, model, source } = freshModel();
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetch([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]);
  await model.syncSource(source);
  db.prepare('UPDATE reservations SET icalSyncLocked = 1').run();

  wipeMappingsAndSummaries(db);
  const moved = { start: isoOffset(40).compact, end: isoOffset(43).compact };
  stubFetch([{ uid: 'GDF1', start: moved.start, end: moved.end, summary: 'BOOKED' }]);
  const result = await model.syncSource(source);
  assert.equal(result.createdCount, 0, 'no duplicate created');
  assert.equal(result.lockedCount, 1);
  assert.equal(db.prepare('SELECT startDate FROM reservations').get().startDate, isoOffset(30).dash, 'locked dates untouched');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_date_drift_alerts WHERE acknowledgedAt IS NULL').get().c, 1);
});

test('rule 2 — a 200 response with a non-ICS body is a sync error, nothing is touched', async () => {
  const { db, model, source } = freshModel();
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetch([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]);
  await model.syncSource(source);

  stubFetchBody('<html><body>Maintenance en cours</body></html>');
  await assert.rejects(() => model.syncSource(source), /Réponse iCal invalide/);
  assert.equal(resCount(db), 1);
  assert.equal(mappingCount(db), 1, 'mappings intact');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts').get().c, 0);
});

test('rule 3 — first empty feed with existing mappings → guarded error, mappings intact, streak 1', async () => {
  const { db, model, source } = freshModel();
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetch([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]);
  await model.syncSource(source);

  stubFetch([]);
  await assert.rejects(() => model.syncSource(source), /Flux vide inattendu/);
  assert.equal(mappingCount(db), 1, 'mappings intact');
  assert.equal(resCount(db), 1, 'reservation intact');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts').get().c, 0, 'no soft-cancellation raised');
  assert.equal(streakOf(db), 1);
});

test('rule 3 — second consecutive empty feed → sweep runs, soft-cancellation raised', async () => {
  const { db, model, source } = freshModel();
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetch([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]);
  await model.syncSource(source);

  stubFetch([]);
  await assert.rejects(() => model.syncSource(source), /Flux vide inattendu/);
  const result = await model.syncSource(source);
  assert.equal(result.removedCount, 1, 'soft-cancellation alert raised on the confirmed empty feed');
  assert.equal(mappingCount(db), 0, 'stale mappings swept');
  assert.equal(resCount(db), 1, 'reservation kept (soft flow)');
  assert.equal(streakOf(db), 2);
});

test('rule 4 — a non-empty sync resets the streak; two empties around it never confirm each other', async () => {
  const { db, model, source } = freshModel();
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetch([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]);
  await model.syncSource(source);

  stubFetch([]);
  await assert.rejects(() => model.syncSource(source), /Flux vide inattendu/);
  assert.equal(streakOf(db), 1);

  stubFetch([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]);
  await model.syncSource(source);
  assert.equal(streakOf(db), 0, 'non-empty parse resets the streak');

  stubFetch([]);
  await assert.rejects(() => model.syncSource(source), /Flux vide inattendu/, 'empty after reset is a first empty again');
  assert.equal(mappingCount(db), 1, 'mappings still intact');
});

test('rule 4 — a fetch failure also resets the streak', async () => {
  const { db, model, source } = freshModel();
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetch([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]);
  await model.syncSource(source);

  stubFetch([]);
  await assert.rejects(() => model.syncSource(source), /Flux vide inattendu/);
  assert.equal(streakOf(db), 1);

  stubFetchError();
  await assert.rejects(() => model.syncSource(source), /Impossible de lire le flux iCal/);
  assert.equal(streakOf(db), 0, 'outage resets the streak');

  stubFetch([]);
  await assert.rejects(() => model.syncSource(source), /Flux vide inattendu/, 'post-outage empty does not confirm the pre-outage one');
  assert.equal(mappingCount(db), 1);
});

test('rule 5 — a matched reservation with an empty icalOriginalSummary is backfilled from the feed', async () => {
  const { db, model, source } = freshModel();
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetch([{ uid: 'GDF1', start: stay.start, end: stay.end, summary: 'BOOKED' }]);
  await model.syncSource(source);
  db.prepare('UPDATE reservations SET icalOriginalSummary = NULL').run();

  await model.syncSource(source);
  assert.equal(db.prepare('SELECT icalOriginalSummary s FROM reservations').get().s, 'BOOKED');
});

test('regression — first-ever sync of an empty feed (no mappings) still succeeds', async () => {
  const { db, model, source } = freshModel();
  stubFetch([]);
  const result = await model.syncSource(source);
  assert.equal(result.createdCount, 0);
  assert.equal(resCount(db), 0);
  assert.equal(streakOf(db), 1, 'emptiness still counted');
});
