// specs/lodgify-decommission.md — Booking.com, Airbnb and Abritel back on their native iCal feeds:
// the Booking echo filter (rules 5-9), the takeover of stays imported through the Lodgify relay
// (rules 1-4, 2bis) and the export tombstones (rule 7).
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const propertyIcalModel = require('../models/propertyIcalModel');
const icalExportRangesModel = require('../models/icalExportRangesModel');
const { classifyBookingEvent } = require('../utils/icalBookingEcho');
const notificationService = require('../utils/notificationService');

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
  CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER, name TEXT, platformKey TEXT, platformLabel TEXT, emptyFeedStreak INTEGER NOT NULL DEFAULT 0);
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
  CREATE TABLE ical_export_ranges (propertyId INTEGER NOT NULL, startDate TEXT NOT NULL, endDate TEXT NOT NULL, PRIMARY KEY (propertyId, startDate, endDate));
  CREATE TABLE ical_export_tombstones (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER NOT NULL, startDate TEXT NOT NULL, endDate TEXT NOT NULL,
    removedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE ical_superseded_events (
    sourceId INTEGER NOT NULL, eventUid TEXT NOT NULL, reservationId INTEGER NOT NULL, supersededBySourceId INTEGER NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (sourceId, eventUid)
  );
`;

const LODGIFY = { id: 1, propertyId: 1, url: 'http://lodgify/ical', platformKey: 'lodgify', platformLabel: 'Lodgify', name: 'Lodgify' };
const BOOKING = { id: 2, propertyId: 1, url: 'http://booking/ical', platformKey: 'booking', platformLabel: 'Booking', name: 'Booking' };
const GREENGO = { id: 3, propertyId: 1, url: 'http://greengo/ical', platformKey: 'greengo', platformLabel: 'Greengo', name: 'Greengo' };
const AIRBNB = { id: 4, propertyId: 1, url: 'http://airbnb/ical', platformKey: 'airbnb', platformLabel: 'Airbnb', name: 'Airbnb' };

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

function fresh() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name, defaultCheckIn, defaultCheckOut, defaultCautionAmount) VALUES (1, 'Gite', '15:00', '10:00', 0)").run();
  const insertSource = db.prepare('INSERT INTO ical_sources (id, propertyId, name, platformKey, platformLabel) VALUES (?, 1, ?, ?, ?)');
  for (const s of [LODGIFY, BOOKING, GREENGO, AIRBNB]) insertSource.run(s.id, s.name, s.platformKey, s.platformLabel);
  return { db, model: propertyIcalModel.buildModel(db) };
}
const all = (db) => db.prepare('SELECT * FROM reservations ORDER BY id').all();

const origFetch = global.fetch;
test.afterEach(() => { global.fetch = origFetch; });

// ---------- pure echo classification ----------

test('classifyBookingEvent: echo, partial and free, counted in nights (checkout is not a night)', () => {
  const cover = [{ startDate: '2027-07-03', endDate: '2027-07-06' }];
  assert.equal(classifyBookingEvent({ startDate: '2027-07-03', endDate: '2027-07-06' }, cover), 'echo');
  assert.equal(classifyBookingEvent({ startDate: '2027-07-04', endDate: '2027-07-05' }, cover), 'echo');
  assert.equal(classifyBookingEvent({ startDate: '2027-07-05', endDate: '2027-07-08' }, cover), 'partial');
  // Arrival on the other stay's departure day: back to back, no shared night.
  assert.equal(classifyBookingEvent({ startDate: '2027-07-06', endDate: '2027-07-09' }, cover), 'free');
  assert.equal(classifyBookingEvent({ startDate: '2027-07-01', endDate: '2027-07-03' }, cover), 'free');
});

test('classifyBookingEvent: two adjacent covering ranges together cover a merged Booking block', () => {
  const cover = [
    { startDate: '2027-07-03', endDate: '2027-07-05' },
    { startDate: '2027-07-05', endDate: '2027-07-08' },
  ];
  assert.equal(classifyBookingEvent({ startDate: '2027-07-03', endDate: '2027-07-08' }, cover), 'echo');
});

// ---------- Booking feed (rules 5, 6, 8, 9) ----------

test('rule 5/9 — a CLOSED event on free dates is a real Booking reservation, not dropped', async () => {
  const { db, model } = fresh();
  stubFetch([closed('B1', '20270707', '20270710')]);
  const r = await model.syncSource(BOOKING);
  assert.equal(r.createdCount, 1);
  const [resa] = all(db);
  assert.equal(resa.platform, 'Booking');
  assert.equal(resa.startDate, '2027-07-07');
  assert.equal(resa.bookingConflictAt, null);
});

test('rule 6 — Booking echoing a GreenGo stay is skipped and counted', async () => {
  const { db, model } = fresh();
  stubFetch([{ uid: 'G1', start: '20270703', end: '20270706', summary: 'Jean Dupont' }]);
  await model.syncSource(GREENGO);
  stubFetch([closed('B-echo', '20270703', '20270706')]);
  const r = await model.syncSource(BOOKING);
  assert.equal(r.echoSkippedCount, 1);
  assert.equal(r.createdCount, 0);
  assert.equal(all(db).length, 1);
});

test('rule 6 — an echo merging a GreenGo stay and a hand-entered stay back to back is skipped', async () => {
  const { db, model } = fresh();
  stubFetch([{ uid: 'G1', start: '20270703', end: '20270705', summary: 'Jean Dupont' }]);
  await model.syncSource(GREENGO);
  db.prepare("INSERT INTO reservations (propertyId, startDate, endDate, platform, sourceType) VALUES (1, '2027-07-05', '2027-07-08', 'direct', 'manual')").run();
  stubFetch([closed('B-merged', '20270703', '20270708')]);
  const r = await model.syncSource(BOOKING);
  assert.equal(r.echoSkippedCount, 1);
  assert.equal(all(db).length, 2);
});

test('rule 8 — a Booking event partly over held nights is created AND flagged in conflict', async () => {
  const { db, model } = fresh();
  stubFetch([{ uid: 'G1', start: '20270704', end: '20270706', summary: 'Jean Dupont' }]);
  await model.syncSource(GREENGO);
  stubFetch([closed('B2', '20270704', '20270707')]);
  const r = await model.syncSource(BOOKING);
  assert.equal(r.createdCount, 1);
  assert.equal(r.conflictReservationIds.length, 1);
  const booking = all(db).find((x) => x.platform === 'Booking');
  assert.ok(booking.bookingConflictAt, 'the conflict flag drives the badge and the notification');
  assert.equal(r.conflictReservationIds[0], booking.id);
});

test('rule 5 — Airbnb keeps dropping its own « Not available » host blocks', async () => {
  const { db, model } = fresh();
  stubFetch([{ uid: 'A-block', start: '20270707', end: '20270710', summary: 'Airbnb (Not available)' }]);
  const r = await model.syncSource(AIRBNB);
  assert.equal(r.createdCount, 0);
  assert.equal(all(db).length, 0);
});

test('Booking re-issuing the UID of one of its own stays re-claims it — no duplicate, no cancellation', async () => {
  const { db, model } = fresh();
  stubFetch([closed('B1', '20270707', '20270710')]);
  await model.syncSource(BOOKING);
  stubFetch([closed('B1-new', '20270707', '20270710')]);
  const r = await model.syncSource(BOOKING);
  assert.equal(all(db).length, 1);
  assert.equal(r.removedCount, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts').get().c, 0);
});

test('rule 4bis — a cancelled Booking stay never hands its fiche to a new one arriving in the same sync', async () => {
  const { db, model } = fresh();
  stubFetch([closed('B-A', '20270707', '20270710')]);
  await model.syncSource(BOOKING);
  const idA = all(db)[0].id;
  stubFetch([closed('B-B', '20270820', '20270823')]);
  const r = await model.syncSource(BOOKING);
  assert.equal(r.createdCount, 1, 'B is a new stay');
  assert.equal(r.removedCount, 1, 'A goes to the cancellation approval');
  const a = db.prepare('SELECT startDate FROM reservations WHERE id = ?').get(idA);
  assert.equal(a.startDate, '2027-07-07', 'A keeps its own dates');
});

// ---------- tombstones (rule 7) ----------

test('rule 7 — a stay that just left the export still covers Booking’s echo; after 72 h it does not', async () => {
  const { db, model } = fresh();
  const ranges = icalExportRangesModel.create(db);
  db.prepare("INSERT INTO reservations (id, propertyId, startDate, endDate, platform, sourceType) VALUES (50, 1, '2027-07-09', '2027-07-11', 'Greengo', 'manual')").run();
  ranges.refresh(1); // the feed was served with this stay in it
  db.prepare('DELETE FROM reservations WHERE id = 50').run(); // cancelled in GuestFlow

  stubFetch([closed('B-ghost', '20270709', '20270711')]);
  const r1 = await model.syncSource(BOOKING);
  assert.equal(r1.echoSkippedCount, 1, 'Booking has not re-read the feed yet: echo, not a phantom booking');
  assert.equal(all(db).length, 0);

  db.prepare("UPDATE ical_export_tombstones SET removedAt = datetime('now', '-80 hours')").run();
  const r2 = await model.syncSource(BOOKING);
  assert.equal(r2.createdCount, 1, 'past the 72 h window, the dates are free again: a real Booking stay');
});

test('rule 7 — refresh writes one tombstone per range that left the export; purge drops them after 7 days', () => {
  const { db } = fresh();
  const ranges = icalExportRangesModel.create(db);
  db.prepare("INSERT INTO reservations (id, propertyId, startDate, endDate, platform) VALUES (60, 1, '2027-08-01', '2027-08-04', 'Airbnb'), (61, 1, '2027-08-10', '2027-08-12', 'Airbnb')").run();
  assert.equal(ranges.refresh(1), 0);
  db.prepare("UPDATE reservations SET startDate = '2027-08-02' WHERE id = 60").run(); // moved
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = 61").run(); // cancelled
  assert.equal(ranges.refresh(1), 2);
  assert.equal(ranges.listActiveTombstones(1).length, 2);
  db.prepare("UPDATE ical_export_tombstones SET removedAt = datetime('now', '-8 days')").run();
  assert.equal(ranges.purge(), 2);
});

// ---------- takeover of Lodgify-relayed stays (rules 1-4) ----------

async function importThroughLodgify(db, model, platform) {
  stubFetch([{ uid: 'L1', start: '20270703', end: '20270706', summary: 'Marie Martin' }]);
  await model.syncSource(LODGIFY);
  // The operator relabels the relayed stay with its real channel, as done today.
  db.prepare('UPDATE reservations SET platform = ?').run(platform);
  return all(db)[0].id;
}

test('rules 1-2 — the native Booking feed takes over a stay relayed by Lodgify: no duplicate, history kept', async () => {
  const { db, model } = fresh();
  const id = await importThroughLodgify(db, model, 'Booking');

  stubFetch([closed('B-native', '20270703', '20270706')]);
  const r = await model.syncSource(BOOKING);
  assert.equal(r.takenOverCount, 1);
  assert.equal(r.echoSkippedCount, 0, 'takeover runs before the echo filter');
  const rows = all(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].sourceIcalSourceId, BOOKING.id);
  assert.equal(rows[0].sourceIcalEventUid, 'B-native');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_import_events WHERE sourceId = ?').get(LODGIFY.id).c, 0);
  const history = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND eventType = 'update'").get(id);
  assert.match(history.changedFields, /Import iCal \(Lodgify\).*Import iCal \(Booking\)/);
});

test('rule 2 — a still-active Lodgify source never re-imports nor cancels a stay taken over from it', async () => {
  const { db, model } = fresh();
  await importThroughLodgify(db, model, 'Booking');
  stubFetch([closed('B-native', '20270703', '20270706')]);
  await model.syncSource(BOOKING);

  stubFetch([{ uid: 'L1', start: '20270703', end: '20270706', summary: 'Marie Martin' }]);
  const again = await model.syncSource(LODGIFY);
  assert.equal(again.createdCount, 0);
  assert.equal(all(db).length, 1);

  stubFetch([{ uid: 'L-other', start: '20271001', end: '20271003', summary: 'Autre Client' }]);
  const dropped = await model.syncSource(LODGIFY);
  assert.equal(dropped.removedCount, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts').get().c, 0);
});

test('rule 1 — the native Airbnb feed takes over its stay the same way', async () => {
  const { db, model } = fresh();
  await importThroughLodgify(db, model, 'Airbnb');
  stubFetch([{ uid: 'A-native', start: '20270703', end: '20270706', summary: 'Reserved' }]);
  const r = await model.syncSource(AIRBNB);
  assert.equal(r.takenOverCount, 1);
  assert.equal(all(db).length, 1);
});

test('rule 4 — a relayed stay still labelled « Lodgify » is not taken over (Airbnb creates its own)', async () => {
  const { db, model } = fresh();
  await importThroughLodgify(db, model, 'Lodgify');
  stubFetch([{ uid: 'A-native', start: '20270703', end: '20270706', summary: 'Reserved' }]);
  const r = await model.syncSource(AIRBNB);
  assert.equal(r.takenOverCount, 0);
  assert.equal(all(db).length, 2, 'the runbook relabels these before the switch');
});

test('rule 1 — a GreenGo stay on the same dates is never taken over by Booking (platform differs)', async () => {
  const { db, model } = fresh();
  stubFetch([{ uid: 'G1', start: '20270703', end: '20270706', summary: 'Jean Dupont' }]);
  await model.syncSource(GREENGO);
  stubFetch([closed('B-echo', '20270703', '20270706')]);
  const r = await model.syncSource(BOOKING);
  assert.equal(r.takenOverCount, 0);
  assert.equal(all(db)[0].sourceIcalSourceId, GREENGO.id);
});

test('rule 1 — two candidates on the same dates: no takeover, the data is already ambiguous', async () => {
  const { db, model } = fresh();
  db.prepare(`INSERT INTO reservations (propertyId, startDate, endDate, platform, sourceType, sourceIcalSourceId)
    VALUES (1, '2027-07-03', '2027-07-06', 'Airbnb', 'ical', 1), (1, '2027-07-03', '2027-07-06', 'Airbnb', 'ical', 3)`).run();
  stubFetch([{ uid: 'A-native', start: '20270703', end: '20270706', summary: 'Reserved' }]);
  const r = await model.syncSource(AIRBNB);
  assert.equal(r.takenOverCount, 0);
});

// ---------- sync result reporting (rule 13) ----------

test('rule 13 — the recorded sync message and counts name the Booking echoes', async () => {
  const { db, model } = fresh();
  db.exec(`ALTER TABLE ical_sources ADD COLUMN url TEXT;
    ALTER TABLE ical_sources ADD COLUMN lastSyncAt TEXT; ALTER TABLE ical_sources ADD COLUMN lastSyncStatus TEXT;
    ALTER TABLE ical_sources ADD COLUMN lastSyncMessage TEXT; ALTER TABLE ical_sources ADD COLUMN lastSyncCounts TEXT;
    ALTER TABLE ical_sources ADD COLUMN lastImportedCount INTEGER; ALTER TABLE ical_sources ADD COLUMN updatedAt TEXT;`);
  stubFetch([{ uid: 'G1', start: '20270703', end: '20270706', summary: 'Jean Dupont' }]);
  await model.syncSource(GREENGO);
  stubFetch([closed('B-echo', '20270703', '20270706')]);
  await model.syncSourceAndRecord(BOOKING);
  const row = db.prepare('SELECT lastSyncMessage, lastSyncCounts FROM ical_sources WHERE id = ?').get(BOOKING.id);
  assert.match(row.lastSyncMessage, /1 écho\(s\) ignoré\(s\)/);
  assert.doesNotMatch(row.lastSyncMessage, /reprise|en conflit/, 'zero counters stay silent');
  assert.deepEqual(
    (({ takenOver, echoSkipped, conflicts }) => ({ takenOver, echoSkipped, conflicts }))(JSON.parse(row.lastSyncCounts)),
    { takenOver: 0, echoSkipped: 1, conflicts: 0 },
  );
});

// ---------- conflict notification copy (rule 8) ----------

test('rule 8 — the conflict e-mail says it comes from the Booking feed, not from an online payment', () => {
  const resa = { id: 7, firstName: 'Booking', lastName: '', propertyName: 'Gite', startDate: '2027-07-04', endDate: '2027-07-07' };
  const ical = notificationService.__test.buildConflictEmail(resa, 'https://gf.example', 'ical');
  assert.match(ical.subject, /flux Booking/);
  assert.doesNotMatch(ical.text, /paiement en ligne/);
  const payment = notificationService.__test.buildConflictEmail(resa, 'https://gf.example');
  assert.match(payment.subject, /paiement en ligne/);
});
