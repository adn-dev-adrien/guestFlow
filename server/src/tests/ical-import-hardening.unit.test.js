// specs/ical-import-hardening.md — the iCal import findings of the review of 2026-10-18: placeholder
// clients per stay (rule 1), stopped sources (rule 2), overlap conflicts on every feed (rule 3), bounded
// fetches (rule 4), truncated feeds (rule 5), repeated UIDs (rule 6), UTC instants (rule 7), placeholder
// names (rule 8), the status line (rule 9) and the `disabled` flag (rule 10).
// The fetch tests use a loopback server and fake hostnames: the private-address guard (rule 17) has its own file.
process.env.GUESTFLOW_ICAL_ALLOW_PRIVATE = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const propertyIcalModel = require('../models/propertyIcalModel');
const { globalFetch } = require('./icalFetchFixture');
const platformsModel = require('../models/platformsModel');
const notificationService = require('../utils/notificationService');
const { parseIcsEvents, parseIcalDate, parseGuestName, resolveIcalClientIdentity, isCompleteIcs } = require('../utils/icalParser');
const { describeIcalSync } = require('../utils/icalSyncStatus');
const { splitSharedIcalPlaceholderClients } = require('../utils/icalPlaceholderClientsMigration');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, defaultCheckIn TEXT, defaultCheckOut TEXT, defaultCautionAmount REAL);
  CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, email TEXT DEFAULT '', phone TEXT DEFAULT '',
    notes TEXT DEFAULT '', address TEXT DEFAULT '', street TEXT DEFAULT '', streetNumber TEXT DEFAULT '',
    postalCode TEXT DEFAULT '', city TEXT DEFAULT '', updatedAt TEXT
  );
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
  CREATE TABLE ical_sources (
    id INTEGER PRIMARY KEY, propertyId INTEGER, name TEXT, url TEXT, platformKey TEXT, platformLabel TEXT,
    isActive INTEGER NOT NULL DEFAULT 1, emptyFeedStreak INTEGER NOT NULL DEFAULT 0,
    lastSyncAt TEXT, lastSyncStatus TEXT, lastSyncMessage TEXT, lastSyncCounts TEXT, lastImportedCount INTEGER, updatedAt TEXT
  );
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

const BOOKING = { id: 2, url: 'http://booking.test/ical', platformKey: 'booking', platformLabel: 'Booking', name: 'Booking' };
const AIRBNB = { id: 4, url: 'http://airbnb.test/ical', platformKey: 'airbnb', platformLabel: 'Airbnb', name: 'Airbnb' };
const LODGIFY = { id: 10, url: 'http://lodgify.test/ical', platformKey: 'lodgify', platformLabel: 'Lodgify', name: 'Lodgify' };

function ics(events, { end = true } = {}) {
  const lines = ['BEGIN:VCALENDAR'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART;VALUE=DATE:${e.start}`, `DTEND;VALUE=DATE:${e.end}`, `SUMMARY:${e.summary || 'Reserved'}`, 'END:VEVENT');
  }
  if (end) lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// One feed per URL; a feed may be a string or a function returning a promise of a response.
function stubFeeds(feeds) {
  global.fetch = async (url, opts) => {
    const feed = feeds[url];
    if (typeof feed === 'function') return feed(opts);
    return { ok: true, text: async () => feed };
  };
}

function fresh(options) {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name, defaultCheckIn, defaultCheckOut, defaultCautionAmount) VALUES (1, 'Gite', '15:00', '10:00', 0)").run();
  const insertSource = db.prepare('INSERT INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel) VALUES (?, 1, ?, ?, ?, ?)');
  for (const s of [BOOKING, AIRBNB, LODGIFY]) insertSource.run(s.id, s.name, s.url, s.platformKey, s.platformLabel);
  return { db, model: propertyIcalModel.buildModel(db, { ...options, fetchImpl: globalFetch }) };
}
const source = (db, id) => db.prepare('SELECT * FROM ical_sources WHERE id = ?').get(id);
const all = (db) => db.prepare('SELECT r.*, c.firstName, c.lastName FROM reservations r LEFT JOIN clients c ON c.id = r.clientId ORDER BY r.id').all();

const origFetch = global.fetch;
test.afterEach(() => { global.fetch = origFetch; });

// ---------- rule 1 — placeholder clients ----------

test('rule 1: two Booking stays without a name get two clients; writing one guest leaves the other stay alone', async () => {
  const { db, model } = fresh();
  stubFeeds({ [BOOKING.url]: ics([
    { uid: 'b1', start: '20270205', end: '20270207', summary: 'CLOSED - Not available' },
    { uid: 'b2', start: '20270226', end: '20270228', summary: 'CLOSED - Not available' },
  ]) });
  await model.syncSource(source(db, BOOKING.id));
  const [first, second] = all(db);
  assert.notEqual(first.clientId, second.clientId);
  db.prepare("UPDATE clients SET firstName = 'David', lastName = 'Roux', email = 'd@guest.booking.com' WHERE id = ?").run(first.clientId);
  assert.deepEqual([all(db)[1].firstName, all(db)[1].lastName], ['Ical', 'Booking']);
});

test('rule 1: a summary that names the guest still reuses that guest’s client', async () => {
  const { db, model } = fresh();
  stubFeeds({ [AIRBNB.url]: ics([
    { uid: 'a1', start: '20270105', end: '20270107', summary: 'Jean Dupont' },
    { uid: 'a2', start: '20270305', end: '20270307', summary: 'Jean Dupont' },
  ]) });
  await model.syncSource(source(db, AIRBNB.id));
  const [a, b] = all(db);
  assert.equal(a.clientId, b.clientId);
});

test('rule 1 (data): the boot pass splits a shared placeholder per stay, renames it, and logs each move in the history', () => {
  const { db } = fresh();
  db.exec(`
    INSERT INTO clients (id, firstName, lastName) VALUES (140, 'Closed', 'Not available'), (141, 'Reserved', 'Ical'), (142, 'Booked', 'Ical');
    INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, platform, sourceType) VALUES
      (1, 1, 140, '2027-02-05', '2027-02-07', 'Booking', 'ical'),
      (2, 1, 140, '2027-02-26', '2027-02-28', 'Booking', 'ical'),
      (3, 1, 141, '2027-03-01', '2027-03-03', 'Airbnb', 'ical'),
      (4, 1, 142, '2027-04-01', '2027-04-03', 'Gîtes de France', 'ical'),
      (5, 1, 142, '2027-05-01', '2027-05-03', 'Gîtes de France', 'ical');
  `);
  assert.deepEqual(splitSharedIcalPlaceholderClients(db), { splitClients: 2, movedReservations: 2, renamedClients: 3 });
  const rows = all(db);
  assert.equal(rows[0].clientId, 140);
  assert.notEqual(rows[1].clientId, 140);
  assert.equal(rows[3].clientId, 142);
  assert.notEqual(rows[4].clientId, 142);
  assert.deepEqual(rows.map((r) => `${r.firstName} ${r.lastName}`), ['Ical Booking', 'Ical Booking', 'Ical Airbnb', 'Ical Gîtes de France', 'Ical Gîtes de France']);
  const history = JSON.parse(db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = 2').get().changedFields);
  assert.deepEqual(history[0], { field: 'clientId', label: 'Client', from: 'Closed Not available', to: 'Ical Booking' });
  assert.deepEqual(splitSharedIcalPlaceholderClients(db), { splitClients: 0, movedReservations: 0, renamedClients: 0 }, 'idempotent');
});

test('rule 1 (data): a shared client carrying a guest’s e-mail, a real name, or a direct stay is never split', () => {
  const { db } = fresh();
  db.exec(`
    INSERT INTO clients (id, firstName, lastName, email) VALUES (150, 'Closed', 'Not available', 'd@guest.booking.com');
    INSERT INTO clients (id, firstName, lastName) VALUES (151, 'Jean', 'Dupont'), (152, 'Ical', 'Booking');
    INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, platform, sourceType) VALUES
      (1, 1, 150, '2027-02-05', '2027-02-07', 'Booking', 'ical'), (2, 1, 150, '2027-02-26', '2027-02-28', 'Booking', 'ical'),
      (3, 1, 151, '2027-03-01', '2027-03-03', 'Airbnb', 'ical'), (4, 1, 151, '2027-04-01', '2027-04-03', 'Airbnb', 'ical'),
      (5, 1, 152, '2027-05-01', '2027-05-03', 'Booking', 'ical'), (6, 1, 152, '2027-06-01', '2027-06-03', 'Direct', 'manual');
  `);
  assert.deepEqual(splitSharedIcalPlaceholderClients(db), { splitClients: 0, movedReservations: 0, renamedClients: 0 });
  assert.deepEqual(all(db).map((r) => r.clientId), [150, 150, 151, 151, 152, 152]);
});

// ---------- rule 2 — stopped sources ----------

test('rule 2: « Synchroniser » on a stopped source is refused with 409 and fetches nothing', async () => {
  const { db, model } = fresh();
  db.prepare('UPDATE ical_sources SET isActive = 0 WHERE id = ?').run(LODGIFY.id);
  let fetched = false;
  global.fetch = async () => { fetched = true; return { ok: true, text: async () => ics([{ uid: 'l1', start: '20270101', end: '20270103' }]) }; };
  const result = await model.syncOne(1, LODGIFY.id);
  assert.deepEqual(result, { error: 'Calendrier arrêté.', status: 409 });
  assert.equal(fetched, false);
  assert.equal(all(db).length, 0);
});

test('rule 2: the platforms payload says a source is stopped', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  const pim = propertyIcalModel.buildModel(db, { fetchImpl: globalFetch });
  pim.createSource(1, { platformKey: 'airbnb', platformLabel: 'Airbnb', url: AIRBNB.url, isActive: false });
  pim.createSource(1, { platformKey: 'booking', platformLabel: 'Booking', url: BOOKING.url });
  const rows = platformsModel.create(db).listForProperty(1);
  const airbnb = rows.find((r) => r.platformKey === 'airbnb');
  const booking = rows.find((r) => r.platformKey === 'booking');
  assert.equal(airbnb.isActive, false);
  assert.equal(airbnb.syncStatus.tone, 'stopped');
  assert.equal(booking.isActive, true);
  assert.equal(booking.syncStatus.text, 'Jamais synchronisé');
  // Rule 10 — the flag is a boolean, never a number the client would print.
  assert.equal(booking.disabled, false);
  assert.equal(rows.find((r) => r.isDirect).disabled, false);
});

// ---------- rule 3 — overlap on every feed ----------

test('rule 3: an Airbnb stay over a direct reservation is created and flagged; the conflict notification names Airbnb', async () => {
  const { db, model } = fresh();
  db.prepare("INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, sourceType) VALUES (1, 1, '2027-03-08', '2027-03-11', 'Direct', 'manual')").run();
  stubFeeds({ [AIRBNB.url]: ics([
    { uid: 'a1', start: '20270309', end: '20270312' },
    { uid: 'a2', start: '20270311', end: '20270313' },
  ]) });
  const calls = [];
  const orig = notificationService.notifyBookingConflict;
  notificationService.notifyBookingConflict = async (id, opts) => { calls.push([id, opts]); };
  try {
    const result = await model.syncSourceAndRecord(source(db, AIRBNB.id));
    const [, overlap, backToBack] = all(db);
    assert.ok(overlap.bookingConflictAt, 'overlapping stay flagged');
    assert.equal(backToBack.bookingConflictAt, null, 'arrival on the departure day is not a conflict');
    assert.deepEqual(result.conflictReservationIds, [overlap.id]);
    assert.deepEqual(calls, [[overlap.id, { origin: 'ical' }]]);
  } finally {
    notificationService.notifyBookingConflict = orig;
  }
  const mail = notificationService.__test.buildConflictEmail({ id: 9, platform: 'Airbnb', propertyName: 'Gite', startDate: '2027-03-09', endDate: '2027-03-12' }, '', 'ical');
  assert.match(mail.subject, /flux Airbnb/);
});

test('rule 3: a pristine stay moved by its feed onto taken nights is flagged once, and notified', async () => {
  const { db, model } = fresh();
  db.prepare("INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, sourceType) VALUES (1, 1, '2027-03-08', '2027-03-11', 'Direct', 'manual')").run();
  stubFeeds({ [AIRBNB.url]: ics([{ uid: 'a1', start: '20270401', end: '20270403' }]) });
  await model.syncSource(source(db, AIRBNB.id));
  stubFeeds({ [AIRBNB.url]: ics([{ uid: 'a1', start: '20270310', end: '20270313' }]) });
  const moved = await model.syncSource(source(db, AIRBNB.id));
  const stay = all(db)[1];
  assert.equal(stay.startDate, '2027-03-10');
  assert.ok(stay.bookingConflictAt);
  assert.deepEqual(moved.movedIntoConflictIds, [stay.id]);
  stubFeeds({ [AIRBNB.url]: ics([{ uid: 'a1', start: '20270309', end: '20270313' }]) });
  assert.deepEqual((await model.syncSource(source(db, AIRBNB.id))).movedIntoConflictIds, [], 'already flagged');
});

// ---------- rule 4 — bounded fetch, feeds fetched together ----------

test('rule 4: a platform that never answers fails within the timeout with a readable message', async () => {
  const server = http.createServer(() => { /* accepts, never answers */ });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { db, model } = fresh({ fetchTimeoutMs: 150 });
  db.prepare('UPDATE ical_sources SET url = ? WHERE id = ?').run(`http://127.0.0.1:${server.address().port}/feed.ics`, AIRBNB.id);
  const started = Date.now();
  try {
    const result = await model.syncOne(1, AIRBNB.id);
    assert.deepEqual(result, { error: 'Plateforme injoignable (délai dépassé).', status: 400 });
    assert.ok(Date.now() - started < 3000);
    assert.equal(source(db, AIRBNB.id).lastSyncStatus, 'error');
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('rule 4: syncMany fetches every feed at once — a stuck feed does not delay the next sources', async () => {
  const { db, model } = fresh({ fetchTimeoutMs: 200 });
  const started = [];
  global.fetch = (url, opts) => {
    started.push(url);
    if (url === AIRBNB.url) {
      return new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason)));
    }
    return Promise.resolve({ ok: true, text: async () => ics([{ uid: `${url}-1`, start: '20270101', end: '20270103', summary: 'Jean Dupont' }]) });
  };
  const sources = db.prepare('SELECT * FROM ical_sources ORDER BY id').all();
  // AbortSignal.timeout does not hold the event loop open; a live server does, the test must too.
  const keepAlive = setInterval(() => {}, 50);
  const results = await model.syncMany(sources).finally(() => clearInterval(keepAlive));
  assert.deepEqual(started, [BOOKING.url, AIRBNB.url, LODGIFY.url], 'all fetches start before any is applied');
  assert.deepEqual(results.map((r) => [r.sourceId, r.ok]), [[2, true], [4, false], [10, true]]);
  assert.equal(results[1].error, 'Plateforme injoignable (délai dépassé).');
});

// ---------- rule 5 — truncated feeds ----------

test('rule 5: a feed without END:VCALENDAR, or with an unclosed event, is refused and raises no cancellation', async () => {
  assert.equal(isCompleteIcs(ics([{ uid: 'x', start: '20270101', end: '20270103' }])), true);
  assert.equal(isCompleteIcs(ics([{ uid: 'x', start: '20270101', end: '20270103' }], { end: false })), false);
  assert.equal(isCompleteIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nEND:VCALENDAR'), false);

  const { db, model } = fresh();
  const two = [{ uid: 'a1', start: '20270101', end: '20270103' }, { uid: 'a2', start: '20270201', end: '20270203' }];
  stubFeeds({ [AIRBNB.url]: ics(two) });
  await model.syncSource(source(db, AIRBNB.id));
  const full = ics(two);
  stubFeeds({ [AIRBNB.url]: full.slice(0, Math.floor(full.length * 0.6)) });
  const result = await model.syncOne(1, AIRBNB.id);
  assert.deepEqual(result, { error: 'Flux iCal incomplet — synchronisation ignorée.', status: 400 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ical_cancellation_alerts').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ical_import_events').get().n, 2);
});

// ---------- rule 6 — repeated UIDs ----------

test('rule 6: two stays under one UID both exist, and a second pass changes nothing', async () => {
  const { db, model } = fresh();
  const feed = ics([
    { uid: 'same', start: '20270110', end: '20270112', summary: 'Jean Dupont' },
    { uid: 'same', start: '20270120', end: '20270122', summary: 'Jean Dupont' },
  ]);
  stubFeeds({ [AIRBNB.url]: feed });
  const first = await model.syncSourceAndRecord(source(db, AIRBNB.id));
  assert.equal(first.createdCount, 2);
  assert.equal(first.repeatedUidCount, 2);
  assert.deepEqual(all(db).map((r) => r.startDate), ['2027-01-10', '2027-01-20']);
  assert.match(source(db, AIRBNB.id).lastSyncMessage, /2 au même identifiant/);
  const second = await model.syncSource(source(db, AIRBNB.id));
  assert.deepEqual([second.createdCount, second.updatedCount, second.unchangedCount], [0, 0, 2]);
});

test('rule 6: RECURRENCE-ID keys a repeated UID when present; a unique UID is untouched', () => {
  const text = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:r', 'RECURRENCE-ID;VALUE=DATE:20270110', 'DTSTART;VALUE=DATE:20270110', 'DTEND;VALUE=DATE:20270112', 'SUMMARY:A', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:r', 'RECURRENCE-ID;VALUE=DATE:20270120', 'DTSTART;VALUE=DATE:20270120', 'DTEND;VALUE=DATE:20270122', 'SUMMARY:A', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:u', 'DTSTART;VALUE=DATE:20270201', 'DTEND;VALUE=DATE:20270203', 'SUMMARY:B', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  assert.deepEqual(parseIcsEvents(text).map((e) => e.uid), ['r#20270110', 'r#20270120', 'u']);
});

// ---------- rule 7 — UTC instants ----------

test('rule 7: a UTC instant is read as a day in Europe/Paris', () => {
  assert.equal(parseIcalDate('20261124T230000Z', false), '2026-11-25');
  assert.equal(parseIcalDate('20260701T215959Z', false), '2026-07-01');
  assert.equal(parseIcalDate('20260701T220000Z', false), '2026-07-02');
  assert.equal(parseIcalDate('20261120', true), '2026-11-20');
});

// ---------- rule 8 — placeholder names ----------

test('rule 8: platform words are not a name — « Closed Not available » and « Reserved » fall back to « Ical <platform> »', () => {
  for (const summary of ['CLOSED - Not available', 'Reserved', 'Réservé', 'Airbnb (Reserved)', 'Reserved Ical', 'BOOKED', 'Booked Ical']) {
    assert.equal(parseGuestName(summary, '').isFallback, true, summary);
  }
  assert.deepEqual(resolveIcalClientIdentity(parseGuestName('CLOSED - Not available', ''), 'Booking'), { firstName: 'Ical', lastName: 'Booking' });
  assert.deepEqual(parseGuestName('Claire Dupont', ''), { firstName: 'Claire', lastName: 'Dupont', isFallback: false });
  assert.deepEqual(parseGuestName('Closer Reserva', ''), { firstName: 'Closer', lastName: 'Reserva', isFallback: false }, 'whole words only');
});

test('rule 11: the Gîtes de France « BOOKED » stays get one « Ical Gîtes de France » client each', async () => {
  const { db, model } = fresh();
  db.prepare("INSERT INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel) VALUES (1, 1, 'GdF', 'http://gdf.test/ical', 'gites-de-france', 'Gîtes de France')").run();
  stubFeeds({ 'http://gdf.test/ical': ics([
    { uid: 'g1', start: '20270205', end: '20270207', summary: 'BOOKED' },
    { uid: 'g2', start: '20270226', end: '20270228', summary: 'BOOKED' },
  ]) });
  await model.syncSource(source(db, 1));
  const [first, second] = all(db);
  assert.notEqual(first.clientId, second.clientId);
  assert.deepEqual([first.firstName, first.lastName], ['Ical', 'Gîtes de France']);
  assert.equal(parseGuestName('Booker Smith', '').isFallback, false, 'whole words only');
});

// ---------- rule 12 — a repeated UID keeps the stay it was mapped to ----------

test('rule 12: when a known UID starts repeating, its stay stays with the event on its own dates — no move, no drift', async () => {
  const { db, model } = fresh();
  stubFeeds({ [AIRBNB.url]: ics([{ uid: 'X', start: '20270120', end: '20270122', summary: 'Jean Dupont' }]) });
  await model.syncSource(source(db, AIRBNB.id));
  const r = all(db)[0];
  db.prepare('UPDATE reservations SET icalSyncLocked = 1 WHERE id = ?').run(r.id);
  stubFeeds({ [AIRBNB.url]: ics([
    { uid: 'X', start: '20270110', end: '20270112', summary: 'Jean Dupont' },
    { uid: 'X', start: '20270120', end: '20270122', summary: 'Jean Dupont' },
  ]) });
  const result = await model.syncSource(source(db, AIRBNB.id));
  const rows = all(db);
  assert.equal(rows.find((row) => row.id === r.id).startDate, '2027-01-20', 'the known stay keeps its dates');
  assert.equal(rows.find((row) => row.id === r.id).sourceIcalEventUid, 'X#2027-01-20');
  assert.deepEqual(rows.map((row) => row.startDate).sort(), ['2027-01-10', '2027-01-20']);
  assert.equal(result.createdCount, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ical_date_drift_alerts').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ical_cancellation_alerts').get().n, 0);
  assert.deepEqual(db.prepare('SELECT eventUid FROM ical_import_events ORDER BY eventUid').all().map((m) => m.eventUid), ['X#2027-01-10', 'X#2027-01-20']);
});

// ---------- rule 13 — the conflict flag follows the dates ----------

test('rule 13: a stay moved off the taken nights loses its conflict flag; moved back, it is flagged again', async () => {
  const { db, model } = fresh();
  db.prepare("INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, sourceType) VALUES (1, 1, '2027-03-08', '2027-03-11', 'Direct', 'manual')").run();
  stubFeeds({ [AIRBNB.url]: ics([{ uid: 'a1', start: '20270309', end: '20270312' }]) });
  await model.syncSource(source(db, AIRBNB.id));
  assert.ok(all(db)[1].bookingConflictAt);
  stubFeeds({ [AIRBNB.url]: ics([{ uid: 'a1', start: '20270409', end: '20270412' }]) });
  await model.syncSource(source(db, AIRBNB.id));
  assert.equal(all(db)[1].bookingConflictAt, null);
  stubFeeds({ [AIRBNB.url]: ics([{ uid: 'a1', start: '20270310', end: '20270313' }]) });
  const back = await model.syncSource(source(db, AIRBNB.id));
  assert.ok(all(db)[1].bookingConflictAt);
  assert.deepEqual(back.movedIntoConflictIds, [all(db)[1].id]);
});

// ---------- rule 14 — the placeholder an intake left behind ----------

test('rule 14: a placeholder no stay uses any more is deleted at the next sync; a client with coordinates is kept', async () => {
  const { db, model } = fresh();
  const feed = ics([{ uid: 'b1', start: '20270205', end: '20270207', summary: 'CLOSED - Not available' }]);
  stubFeeds({ [BOOKING.url]: feed });
  await model.syncSource(source(db, BOOKING.id));
  const placeholder = all(db)[0].clientId;
  db.exec(`
    INSERT INTO clients (id, firstName, lastName, email) VALUES (500, 'David', 'Roux', 'd@guest.booking.com'), (501, 'Ical', 'Booking', 'kept@x.fr');
    UPDATE reservations SET clientId = 500;
  `);
  await model.syncSource(source(db, BOOKING.id));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM clients WHERE id = ?').get(placeholder).n, 0);
  assert.deepEqual(db.prepare('SELECT id FROM clients ORDER BY id').all().map((c) => c.id), [500, 501]);
});

// ---------- rule 9 — status line ----------

test('rule 9: the status line says when and only what changed; the engine sentence is the detail', () => {
  const now = new Date('2026-10-18T08:00:00Z');
  const row = {
    url: 'http://x', isActive: 1, lastSyncStatus: 'success', lastSyncAt: '2026-10-18 00:05:00',
    lastSyncMessage: '1 créé(s), 0 mis à jour, 0 verrouillé(s), 1 annulation(s) à valider, 15 inchangé(s)',
    syncCounts: { created: 1, updated: 0, removed: 1, unchanged: 15, locked: 0, conflicts: 0 },
  };
  assert.deepEqual(describeIcalSync(row, { now, timeZone: 'Europe/Paris' }), {
    tone: 'success', text: 'Synchronisé à 02:05 · 1 nouvelle, 1 annulation à valider', detail: row.lastSyncMessage,
  });
  assert.equal(describeIcalSync({ ...row, syncCounts: { unchanged: 15 } }, { now, timeZone: 'Europe/Paris' }).text, 'Synchronisé à 02:05');
  assert.equal(describeIcalSync({ ...row, lastSyncAt: '2026-10-16 21:30:00' }, { now, timeZone: 'Europe/Paris' }).text.startsWith('Synchronisé le 16/10 à 23:30'), true);
  assert.equal(describeIcalSync({ ...row, lastSyncStatus: 'error', lastSyncMessage: 'Plateforme injoignable.' }, { now, timeZone: 'Europe/Paris' }).text, 'Échec à 02:05 : Plateforme injoignable.');
  assert.equal(describeIcalSync({ ...row, url: '' }).tone, 'manual');
  assert.equal(describeIcalSync({ ...row, isActive: 0 }).tone, 'stopped');
  assert.equal(describeIcalSync({ url: 'http://x', isActive: 1 }).text, 'Jamais synchronisé');
});
