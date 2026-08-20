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
  /* establishment_closures was added 2026-06-06 — the sync engine now consults it via
     the closure guard in propertyIcalModel. Pre-existing sync tests don't seed closures
     so the table is just empty in this fixture (the guard finds no row → no skip). */
  CREATE TABLE establishment_closures (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER,
    label TEXT NOT NULL DEFAULT 'Fermeture établissement',
    startDate TEXT NOT NULL, endDate TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
  );
  /* Property option defaults + their target tables — the sync now applies them to a freshly
     created iCal reservation (specs/bed-config-in-linen-card.md §10 follow-up 2026-06-08). */
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

function stubFetch(events) {
  global.fetch = async () => ({ ok: true, text: async () => icsFeed(events) });
}

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, defaultCheckIn, defaultCheckOut, defaultCautionAmount) VALUES (1, '15:00', '10:00', 500)").run();
  // The empty-feed guard persists its streak on the ical_sources row — the source must exist in DB.
  db.prepare("INSERT INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel) VALUES (1, 1, 'Airbnb', 'http://feed.test/ical', 'airbnb', 'Airbnb')").run();
  const model = propertyIcalModel.buildModel(db);
  const source = { id: 1, propertyId: 1, url: 'http://feed.test/ical', platformKey: 'airbnb', platformLabel: 'Airbnb', name: 'Airbnb' };
  return { db, model, source };
}

// Empty-feed guard (specs/ical-sync-mapping-resilience.md §3 rule 3): a feed that suddenly
// parses to 0 events while mappings exist is only trusted from the 2nd consecutive empty fetch.
// Tests that legitimately empty a feed sync twice through this helper.
async function syncEmptyConfirmed(model, source) {
  await assert.rejects(() => model.syncSource(source), /Flux vide inattendu/);
  return model.syncSource(source);
}

// A date `days` away from today, in both the ICS compact (YYYYMMDD) and the stored
// dash (YYYY-MM-DD) forms — keeps the past/future cancellation tests robust to the
// actual run date instead of hard-coding July 2026.
function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return { dash: `${y}-${m}-${day}`, compact: `${y}${m}${day}` };
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
  // The genuinely-new reservation id is surfaced for the per-reservation email notification
  // (specs/site-booking-notifications.md §3 rule 7).
  assert.deepEqual(result.createdReservationIds.map(Number), [Number(row.id)]);
});

test('create: the iCal import leaves `notes` empty and keeps the summary only in icalOriginalSummary', async () => {
  // Regression: the import used to dump "Import iCal (...)\nUID: ...\nRésumé: ..." into the
  // operator-facing note field — noise. The summary now lives only in its own column.
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  const row = db.prepare('SELECT notes, icalOriginalSummary FROM reservations').get();
  assert.equal(row.notes, '', 'notes stays empty on import');
  assert.equal(row.icalOriginalSummary, 'Jean Dupont', 'the summary is preserved in its own column');
});

test('create: the client auto-created by the import gets an empty note', async () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  const client = db.prepare('SELECT firstName, lastName, notes FROM clients').get();
  assert.equal(client.firstName, 'Jean');
  assert.equal(client.lastName, 'Dupont');
  assert.equal(client.notes, '', 'no auto-generated mention in the client note');
});

test('update: a re-sync never clobbers the operator note', async () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  db.prepare("UPDATE reservations SET notes = 'Caution rendue en main propre' WHERE sourceIcalEventUid = 'E1'").run();

  // The source pushes a date change → full update path runs, but `notes` must be left alone.
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260715', summary: 'Jean Dupont' }]);
  const result = await model.syncSource(source);
  assert.equal(result.updatedCount, 1);
  assert.equal(db.prepare('SELECT endDate FROM reservations').get().endDate, '2026-07-15');
  assert.equal(db.prepare('SELECT notes FROM reservations').get().notes, 'Caution rendue en main propre');
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
  // An UPDATE must not be reported as a creation → no notification fires (rule 7 edge case).
  assert.deepEqual(result.createdReservationIds, []);
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
  // Future-relative dates: a PAST stay falling out of the feed is deliberately NOT a cancellation
  // (past-stay carve-out) — hardcoded July-2026 dates made these tests rot once that month passed.
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetch([{ uid: 'E1', start: stay.start, end: stay.end, summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  stubFetch([]);
  const result = await syncEmptyConfirmed(model, source);
  assert.equal(result.removedCount, 1, 'removedCount counts pending cancellation alerts');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations').get().c, 1, 'reservation kept (soft flow)');
  const pending = db.prepare("SELECT reservationId, sourceId, eventUid FROM ical_cancellation_alerts WHERE acknowledgedAt IS NULL").all();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].eventUid, 'E1');
});

test('cancellation: locked reservation falls out of feed → still soft-cancelled (no lock short-circuit)', async () => {
  // The lock does NOT protect against soft cancellation; the user explicitly approves.
  const { db, model, source } = freshModel();
  // Future-relative dates: a PAST stay falling out of the feed is deliberately NOT a cancellation
  // (past-stay carve-out) — hardcoded July-2026 dates made these tests rot once that month passed.
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetch([{ uid: 'E1', start: stay.start, end: stay.end, summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  db.prepare("UPDATE reservations SET icalSyncLocked = 1 WHERE sourceIcalEventUid = 'E1'").run();
  stubFetch([]);
  await syncEmptyConfirmed(model, source);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts WHERE acknowledgedAt IS NULL').get().c, 1);
});

test('cancellation: repeated empty-feed sync keeps ONE pending row (UPSERT)', async () => {
  const { db, model, source } = freshModel();
  // Future-relative dates: a PAST stay falling out of the feed is deliberately NOT a cancellation
  // (past-stay carve-out) — hardcoded July-2026 dates made these tests rot once that month passed.
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetch([{ uid: 'E1', start: stay.start, end: stay.end, summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  stubFetch([]);
  await syncEmptyConfirmed(model, source);
  await model.syncSource(source);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts').get().c, 1);
});

test('cancellation: auto-resolve when the UID reappears in the feed before the user reacts', async () => {
  // specs/ical-cancellation-approval.md §3 rule 4 — the alert is dropped silently.
  const { db, model, source } = freshModel();
  // Future-relative dates: a PAST stay falling out of the feed is deliberately NOT a cancellation
  // (past-stay carve-out) — hardcoded July-2026 dates made these tests rot once that month passed.
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetch([{ uid: 'E1', start: stay.start, end: stay.end, summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  stubFetch([]);
  await syncEmptyConfirmed(model, source);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts WHERE acknowledgedAt IS NULL').get().c, 1);

  // The platform un-cancels: same UID is back in the feed.
  stubFetch([{ uid: 'E1', start: stay.start, end: stay.end, summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts').get().c, 0, 'pending row deleted, not acknowledged');
  // The reservation also re-acquires its mapping in the standard create/legacy-match path.
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations').get().c, 1);
});

test('cancellation: a PAST stay dropped from the feed is NOT flagged (platforms prune bygone bookings)', async () => {
  // specs/ical-cancellation-approval.md §3 rule 1, past-stay carve-out. A reservation whose
  // checkout is already behind us is not a cancellation to validate when its UID leaves the feed.
  const { db, model, source } = freshModel();
  const start = isoOffset(-20);
  const end = isoOffset(-15);
  stubFetch([{ uid: 'PAST1', start: start.compact, end: end.compact, summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations').get().c, 1, 'past stay created on first sync');
  stubFetch([]);
  const result = await syncEmptyConfirmed(model, source);
  assert.equal(result.removedCount, 0, 'no cancellation alert for a past stay');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts WHERE acknowledgedAt IS NULL').get().c, 0, 'no pending alert recorded');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations').get().c, 1, 'reservation kept (real past stay)');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_import_events').get().c, 0, 'stale mapping still dropped');
});

test('cancellation: a stay ending TODAY dropped from the feed IS still flagged (strict past boundary)', async () => {
  // endDate === today is NOT "past" (strict <), so a same-day checkout still raises an alert.
  const { db, model, source } = freshModel();
  const start = isoOffset(-3);
  const end = isoOffset(0);
  stubFetch([{ uid: 'TODAY1', start: start.compact, end: end.compact, summary: 'Marie Martin' }]);
  await model.syncSource(source);
  stubFetch([]);
  const result = await syncEmptyConfirmed(model, source);
  assert.equal(result.removedCount, 1, 'a same-day checkout is not past → alert raised');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts WHERE acknowledgedAt IS NULL').get().c, 1);
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
  // Future-relative dates: a PAST stay falling out of the feed is deliberately NOT a cancellation
  // (past-stay carve-out) — hardcoded July-2026 dates made these tests rot once that month passed.
  const stay = { start: isoOffset(30).compact, end: isoOffset(33).compact };
  stubFetch([{ uid: 'E1', start: stay.start, end: stay.end, summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM clients').get().c, 1);

  // Same UID, different summary → an update (hash changes). The client must not be re-created
  // (the update never relinks clientId, so resolving a new client would orphan it).
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Marie Martin' }]);
  const result = await model.syncSource(source);
  assert.equal(result.updatedCount, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM clients').get().c, 1);
});

test('summary fallback (step 3.5): unlocked moved booking with NEW UID → re-claim + dates rewritten', async () => {
  // specs/ical-summary-fallback-cross-uid.md §7.
  // Replays the Abracadaroom case: same booking #144253 reappears with a new UID and
  // new dates. Every prior fallback fails because they key on the new dates; step 3.5
  // matches by the stable summary and re-claims the existing reservation.
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'OLDUID', start: '20260606', end: '20260607', summary: 'Booking #144253' }]);
  await model.syncSource(source);
  const beforeId = db.prepare('SELECT id FROM reservations').get().id;

  stubFetch([{ uid: '7517039833', start: '20261010', end: '20261011', summary: 'Booking #144253' }]);
  const result = await model.syncSource(source);

  assert.equal(result.createdCount, 0, 'no new reservation created');
  assert.equal(result.updatedCount, 1, 'existing reservation updated in place');
  assert.equal(result.removedCount, 0, 'no cancellation alert raised');
  const row = db.prepare('SELECT id, startDate, endDate, sourceIcalEventUid FROM reservations').get();
  assert.equal(row.id, beforeId, 'same reservation row preserved');
  assert.equal(row.startDate, '2026-10-10');
  assert.equal(row.endDate, '2026-10-11');
  assert.equal(row.sourceIcalEventUid, '7517039833');
  const mappings = db.prepare('SELECT eventUid, startDate, endDate FROM ical_import_events').all();
  assert.equal(mappings.length, 1, 'OLD mapping dropped, NEW mapping in place');
  assert.equal(mappings[0].eventUid, '7517039833');
});

test('summary fallback (step 3.5): LOCKED moved booking with NEW UID → date-drift alert, no auto-update', async () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'OLDUID', start: '20260606', end: '20260607', summary: 'Booking #144253' }]);
  await model.syncSource(source);
  db.prepare("UPDATE reservations SET icalSyncLocked = 1 WHERE sourceIcalEventUid = 'OLDUID'").run();

  stubFetch([{ uid: '7517039833', start: '20261010', end: '20261011', summary: 'Booking #144253' }]);
  const result = await model.syncSource(source);

  assert.equal(result.lockedCount, 1);
  assert.equal(result.updatedCount, 0);
  assert.equal(result.removedCount, 0, 'no cancellation alert raised');
  const row = db.prepare('SELECT startDate, endDate FROM reservations').get();
  assert.equal(row.startDate, '2026-06-06', 'persisted dates unchanged on locked rez');
  assert.equal(row.endDate, '2026-06-07');
  const drifts = db.prepare(`
    SELECT previousStartDate, previousEndDate, newStartDate, newEndDate
      FROM ical_date_drift_alerts WHERE acknowledgedAt IS NULL
  `).all();
  assert.equal(drifts.length, 1, 'one date-drift card on the Dashboard');
  assert.equal(drifts[0].previousStartDate, '2026-06-06');
  assert.equal(drifts[0].newStartDate, '2026-10-10');
});

test('summary fallback (step 3.5): AMBIGUOUS summary (≥2 same-source mappings) → no re-claim, INSERT new', async () => {
  // Two existing mappings with the SAME summaryNormalized → uniqueness gate blocks the
  // re-claim, the new event falls through to the standard INSERT path. Protects against
  // false-positive remaps on generic summaries (e.g. "Booked Ical").
  //
  // 2026-06-06 — switched the fixture summary from "Closed Period" to "Booked Ical"
  // because `isUnavailableIcalEvent` now drops the former at parse time (Adrien asked
  // for that filter, see properties-ical.unit.test.js). "Booked Ical" is the other
  // generic phrasing the comment already called out and still flows through the
  // pipeline, so the ambiguity contract this test pins is unchanged.
  const { db, model, source } = freshModel();
  stubFetch([
    { uid: 'A1', start: '20260601', end: '20260602', summary: 'Booked Ical' },
    { uid: 'A2', start: '20260701', end: '20260702', summary: 'Booked Ical' },
  ]);
  await model.syncSource(source);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations').get().c, 2);

  stubFetch([
    { uid: 'A1', start: '20260601', end: '20260602', summary: 'Booked Ical' },
    { uid: 'A2', start: '20260701', end: '20260702', summary: 'Booked Ical' },
    { uid: 'A3', start: '20261010', end: '20261011', summary: 'Booked Ical' },
  ]);
  const result = await model.syncSource(source);
  assert.equal(result.createdCount, 1, 'ambiguous summary → INSERT new, no false remap');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations').get().c, 3);
});

test('summary fallback (step 3.5): empty/unavailable-summary new event still works via standard INSERT', async () => {
  // Edge case: the parser may strip the summary entirely. The summary fallback skips
  // empty summaries (existing `if (!mapping && summaryNormalized)` guard reused).
  const { db, model, source } = freshModel();
  // Future dates so the old stale UID legitimately raises an alert (a PAST stay would be
  // exempt by the past-stay carve-out — see the dedicated cancellation tests above).
  const oldStart = isoOffset(30);
  const oldEnd = isoOffset(31);
  stubFetch([{ uid: 'OLDUID', start: oldStart.compact, end: oldEnd.compact, summary: 'Booking #144253' }]);
  await model.syncSource(source);

  // New event without a summary: cannot re-claim → goes to INSERT. The old reservation
  // stays alive and the old UID is now stale → raises a cancellation alert.
  const newStart = isoOffset(60);
  const newEnd = isoOffset(61);
  stubFetch([{ uid: 'NEWUID', start: newStart.compact, end: newEnd.compact, summary: '' }]);
  const result = await model.syncSource(source);
  assert.equal(result.createdCount, 1, 'empty-summary new event always inserts');
  assert.equal(result.removedCount, 1, 'old UID becomes stale → cancellation alert');
});

test('syncSourceAndRecord writes the source status row', async () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSourceAndRecord(source);
  const row = db.prepare('SELECT lastSyncStatus, lastImportedCount FROM ical_sources WHERE id = 1').get();
  assert.equal(row.lastSyncStatus, 'success');
  assert.equal(row.lastImportedCount, 1);
});

test('create: an iCal reservation gets the property bed-linen default, marked offered', async () => {
  // specs/bed-config-in-linen-card.md §10 follow-up (2026-06-08). On "Gite", bed linen is a
  // property default flagged offered; a freshly-arrived iCal booking must carry that option
  // (offered=1) so it shows on the reservation immediately, free of charge.
  const { db, model, source } = freshModel();
  db.prepare("INSERT INTO options (id, title, priceType, price, countsAsBedLinen) VALUES (7, 'Linge de lit', 'per_stay', 0, 1)").run();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 7, 1)').run();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  await model.syncSource(source);
  const opt = db.prepare('SELECT * FROM reservation_options').get();
  assert.ok(opt, 'a reservation_options row was created for the default');
  assert.equal(opt.optionId, 7);
  assert.equal(opt.quantity, 1);
  assert.equal(opt.offered, 1);
});

test('create: a non-offered property default lands on the iCal reservation as not-offered', async () => {
  const { db, model, source } = freshModel();
  db.prepare("INSERT INTO options (id, title, priceType, price, countsAsBedLinen) VALUES (8, 'Ménage', 'per_stay', 50, 0)").run();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 8, 0)').run();
  stubFetch([{ uid: 'E2', start: '20260801', end: '20260804', summary: 'Marie Durand' }]);
  await model.syncSource(source);
  const opt = db.prepare('SELECT * FROM reservation_options WHERE optionId = 8').get();
  assert.ok(opt);
  assert.equal(opt.offered, 0);
});

// ── Platform payout deadline (specs/platform-payout-due-date.md §3.1 rules 8-9) ───────────────

test('create: the import stamps the platform payout deadline — departure + 10 by default', () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  return model.syncSource(source).then(() => {
    const row = db.prepare('SELECT endDate, balanceDueDate, balanceAmount FROM reservations').get();
    assert.equal(row.endDate, '2026-07-13');
    assert.equal(row.balanceDueDate, '2026-07-23');
    // Rule 9: the deadline is written even though the amount is only known later, when the operator
    // enters the platform's figures.
    assert.equal(row.balanceAmount, 0);
  });
});

test('create: the platform\'s own delay is used when the catalogue has one', () => {
  const { db, model, source } = freshModel();
  // The catalogue as the platforms model expects it (it prepares its statements eagerly, so a
  // half-shaped table degrades to the default delay instead of being read).
  db.exec(`CREATE TABLE platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
    commissionAccountNumber TEXT, hasVatOnCommission INTEGER NOT NULL DEFAULT 0,
    commissionPercent REAL NOT NULL DEFAULT 0, color TEXT,
    payoutDueDays INTEGER NOT NULL DEFAULT 10
  )`);
  db.prepare("INSERT INTO platforms (name, payoutDueDays) VALUES ('Airbnb', 3)").run();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  return model.syncSource(source).then(() => {
    assert.equal(db.prepare('SELECT balanceDueDate FROM reservations').get().balanceDueDate, '2026-07-16');
  });
});

test('update: a date drift on a pristine reservation moves the payout deadline with the departure', () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  return model.syncSource(source).then(() => {
    stubFetch([{ uid: 'E1', start: '20260710', end: '20260718', summary: 'Jean Dupont' }]);
    return model.syncSource(source);
  }).then(() => {
    const row = db.prepare('SELECT endDate, balanceDueDate FROM reservations').get();
    assert.equal(row.endDate, '2026-07-18');
    assert.equal(row.balanceDueDate, '2026-07-28', 'the deadline follows the new departure (rule 8)');
  });
});

test('locked: a drift the operator has not approved moves neither the dates nor the deadline', () => {
  const { db, model, source } = freshModel();
  stubFetch([{ uid: 'E1', start: '20260710', end: '20260713', summary: 'Jean Dupont' }]);
  return model.syncSource(source).then(() => {
    db.prepare('UPDATE reservations SET icalSyncLocked = 1').run();
    stubFetch([{ uid: 'E1', start: '20260710', end: '20260718', summary: 'Jean Dupont' }]);
    return model.syncSource(source);
  }).then(() => {
    const row = db.prepare('SELECT endDate, balanceDueDate FROM reservations').get();
    assert.equal(row.endDate, '2026-07-13');
    assert.equal(row.balanceDueDate, '2026-07-23');
  });
});
