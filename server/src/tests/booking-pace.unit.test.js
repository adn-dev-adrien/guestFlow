const test = require('node:test');
const assert = require('node:assert/strict');

// specs/booking-pace.md — réservations à date vs the same date last year: what is on the books at a
// date, the three figures per stay month, the non-comparable state, the pickup and the pickup curve.
const { freshDb, insert } = require('./financeDashboardFixture');
const bookingPaceModel = require('../models/bookingPaceModel');
const icalCancellationModel = require('../models/icalCancellationModel');
const pace = require('../utils/bookingPace');

const TODAY = '2026-09-30';

function setup() {
  const { db } = freshDb();
  db.exec(`
    ALTER TABLE reservations ADD COLUMN cancelledAt TEXT;
    CREATE TABLE booking_pace_cancellations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, propertyId INTEGER,
      startDate TEXT NOT NULL, endDate TEXT NOT NULL, totalSejour REAL NOT NULL DEFAULT 0,
      reservationCreatedAt TEXT, cancelledAt TEXT NOT NULL DEFAULT (datetime('now')),
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const model = bookingPaceModel.buildModel(db);
  return { db, model, get: (p = {}) => model.getPace({ today: TODAY, ...p }) };
}

// The initial import: a stay created long ago, so booking dates are trusted from the day after.
const seedImport = (db) => insert(db, { startDate: '2024-10-05', endDate: '2024-10-07', createdAt: '2024-09-01 09:00:00', balanceAmount: 100 });

const month = (data, ym) => data.months.find((m) => m.month === ym);
const stay = (o) => ({ propertyId: 1, totalSejour: 0, cancelledOn: null, ...o });

test('rule 2 — on the books: booked on or before D, not cancelled on or before D', () => {
  const s = stay({ startDate: '2026-12-01', endDate: '2026-12-03', bookedOn: '2026-09-10', cancelledOn: '2026-09-20' });
  assert.equal(pace.isOnBooks(s, '2026-09-09'), false);
  assert.equal(pace.isOnBooks(s, '2026-09-10'), true);
  assert.equal(pace.isOnBooks(s, '2026-09-19'), true);
  assert.equal(pace.isOnBooks(s, '2026-09-20'), false);
  assert.equal(pace.isOnBooks(stay({ bookedOn: '2026-09-10', cancelledOn: '2026-09-10' }), '2026-09-10'), false);
});

test('rule 3 — reservations in the arrival month, nights split across months, revenue spread on nights', () => {
  const s = stay({ startDate: '2026-09-29', endDate: '2026-10-03', totalSejour: 400, bookedOn: '2026-01-01' });
  assert.equal(pace.valueInMonth(s, '2026-09', 'reservations'), 1);
  assert.equal(pace.valueInMonth(s, '2026-10', 'reservations'), 0);
  assert.equal(pace.valueInMonth(s, '2026-09', 'nights'), 2);
  assert.equal(pace.valueInMonth(s, '2026-10', 'nights'), 2);
  assert.equal(pace.valueInMonth(s, '2026-09', 'revenue') + pace.valueInMonth(s, '2026-10', 'revenue'), 400);
  assert.equal(pace.valueInMonth(s, '2026-11', 'nights'), 0);
});

test('rules 1, 5-7 — booking date = fiche creation; current, same date last year, final last year, écart, reste, part atteinte', () => {
  const { db, get } = setup();
  seedImport(db);
  // Last year: two October stays booked before 30/09/2025, one booked after.
  insert(db, { startDate: '2025-10-10', endDate: '2025-10-13', createdAt: '2025-06-01 10:00:00' });
  insert(db, { startDate: '2025-10-20', endDate: '2025-10-22', createdAt: '2025-09-30 18:00:00' });
  insert(db, { startDate: '2025-10-25', endDate: '2025-10-27', createdAt: '2025-10-05 10:00:00' });
  // This year: three October stays already booked, one devis ignored.
  insert(db, { startDate: '2026-10-02', endDate: '2026-10-04', createdAt: '2026-05-01 10:00:00' });
  insert(db, { startDate: '2026-10-09', endDate: '2026-10-11', createdAt: '2026-08-01 10:00:00' });
  insert(db, { startDate: '2026-10-16', endDate: '2026-10-17', createdAt: '2026-09-29 10:00:00' });
  insert(db, { kind: 'devis', startDate: '2026-10-20', endDate: '2026-10-22', createdAt: '2026-09-01 10:00:00' });

  const { data } = get();
  assert.equal(data.months.length, 12);
  assert.equal(data.months[0].month, '2026-09');
  assert.deepEqual([data.months[0].tick, data.months[1].tick, data.months[4].tick], ['sept. 26', 'oct.', 'janv. 27']);
  assert.deepEqual([data.months[1].label, data.months[1].lastYearLabel], ['octobre 2026', 'octobre 2025']);
  const oct = month(data, '2026-10');
  assert.deepEqual(
    { current: oct.current, stly: oct.sameTimeLastYear, final: oct.lastYearFinal, delta: oct.delta, pct: oct.deltaPct, remaining: oct.remaining, reached: oct.reachedPct },
    { current: 3, stly: 2, final: 3, delta: 1, pct: 0.5, remaining: 0, reached: 1 },
  );
  assert.equal(oct.tone, 'success');
  assert.equal(month(data, '2027-03').tone, 'neutral');
  const nights = get({ metric: 'nights' }).data;
  assert.equal(month(nights, '2026-10').current, 5);
  assert.equal(month(nights, '2026-10').sameTimeLastYear, 5);
  assert.equal(month(nights, '2026-10').lastYearFinal, 7);
  assert.equal(month(nights, '2026-10').remaining, 2);
});

test('rule 2 — a manually cancelled stay counted until its cancellation, last year included', () => {
  const { db, get } = setup();
  seedImport(db);
  insert(db, { kind: 'cancelled', startDate: '2025-11-10', endDate: '2025-11-12', createdAt: '2025-08-01 10:00:00', cancelledAt: '2025-10-15 10:00:00' });
  insert(db, { kind: 'cancelled', startDate: '2026-11-10', endDate: '2026-11-12', createdAt: '2026-08-01 10:00:00', cancelledAt: '2026-09-15 10:00:00' });
  const nov = month(get().data, '2026-11');
  assert.equal(nov.sameTimeLastYear, 1);
  assert.equal(nov.lastYearFinal, 0);
  assert.equal(nov.current, 0);
  assert.equal(nov.reachedPct, null);
});

test('rules 8-10 — no comparison before a year of booking dates; last year final still shown', () => {
  const { db, get } = setup();
  // Initial import on 12/04/2026: everything booked before GuestFlow lands that day.
  insert(db, { startDate: '2025-10-10', endDate: '2025-10-12', createdAt: '2026-04-12 08:00:00' });
  insert(db, { startDate: '2026-10-10', endDate: '2026-10-12', createdAt: '2026-04-12 08:00:00' });
  const { data } = get();
  assert.equal(data.paceStart, '2026-04-13');
  assert.equal(data.comparableFrom, '2027-04-13');
  const oct = month(data, '2026-10');
  assert.equal(oct.sameTimeLastYear, null);
  assert.equal(oct.comparable, false);
  assert.equal(oct.delta, null);
  assert.equal(oct.lastYearFinal, 1);
  assert.equal(data.summary.comparableMonths, 0);
  assert.equal(data.summary.text, 'Au 30 sept., 1 réservation pour les 12 prochains mois.');
  assert.match(data.summary.notice, /à partir du 13 avril 2027/);
  assert.equal(data.pickup.last30.lastYear, null);
});

test('rule 9 — a month before the coverage start has no last year at all', () => {
  const { db, get } = setup();
  insert(db, { startDate: '2026-01-10', endDate: '2026-01-12', createdAt: '2025-06-01 10:00:00' });
  const oct = month(get().data, '2026-10');
  assert.equal(oct.lastYearFinal, null);
  assert.equal(oct.sameTimeLastYear, null);
  assert.equal(month(get().data, '2027-01').lastYearFinal, 1);
});

test('rule 11 — summary over comparable months, tone and wording per metric', () => {
  const { db, get } = setup();
  seedImport(db);
  insert(db, { startDate: '2025-12-10', endDate: '2025-12-14', createdAt: '2025-07-01 10:00:00', balanceAmount: 400 });
  insert(db, { startDate: '2026-12-10', endDate: '2026-12-12', createdAt: '2026-07-01 10:00:00', balanceAmount: 250 });
  const r = get().data.summary;
  assert.deepEqual([r.current, r.sameTimeLastYear, r.delta, r.deltaPct, r.change, r.tone], [1, 1, 0, 0, 0, 'neutral']);
  assert.equal(r.text, "Au 30 sept., 1 réservation pour les 12 prochains mois, contre 1 l'an dernier à la même date (autant).");
  const n = get({ metric: 'nights' }).data.summary;
  assert.deepEqual([n.current, n.sameTimeLastYear, n.delta, n.deltaPct, n.change, n.tone], [2, 4, -2, -0.5, -50, 'error']);
  assert.equal(n.text, "Au 30 sept., 2 nuits réservées pour les 12 prochains mois, contre 4 l'an dernier à la même date (−2).");
  const e = get({ metric: 'revenue' }).data.summary;
  assert.equal(e.current, 250);
  assert.equal(e.text, "Au 30 sept., 250 € de CA des nuits réservé pour les 12 prochains mois, contre 400 € l'an dernier à la même date (−150 €).");
});

test('rule 12 — pickup of the last 7 / 30 days, net of cancellations, next to last year', () => {
  const { db, get } = setup();
  seedImport(db);
  insert(db, { startDate: '2026-11-01', endDate: '2026-11-04', createdAt: '2026-09-28 10:00:00' });
  insert(db, { startDate: '2026-12-01', endDate: '2026-12-03', createdAt: '2026-09-10 10:00:00' });
  insert(db, { kind: 'cancelled', startDate: '2027-01-01', endDate: '2027-01-03', createdAt: '2026-06-01 10:00:00', cancelledAt: '2026-09-29 10:00:00' });
  insert(db, { startDate: '2025-11-01', endDate: '2025-11-03', createdAt: '2025-09-25 10:00:00' });
  const { pickup } = get().data;
  assert.deepEqual(pickup.last7, { current: 0, lastYear: 1 });
  assert.deepEqual(pickup.last30, { current: 1, lastYear: 1 });
  assert.deepEqual(get({ metric: 'nights' }).data.pickup.last7, { current: 1, lastYear: 2 });
});

test('29 February compares with 28 February', () => {
  const s = [stay({ startDate: '2027-03-10', endDate: '2027-03-12', bookedOn: '2027-02-28' }), stay({ startDate: '2024-01-01', endDate: '2024-01-02', bookedOn: '2023-01-01' })];
  const data = pace.buildPace({ stays: s, today: '2028-02-29', metric: 'reservations', coverageMonth: '2024-01' });
  assert.equal(data.asOfLastYear, '2027-02-28');
  assert.equal(data.months.find((m) => m.month === '2028-03').sameTimeLastYear, 1);
});

test('rule 13 — pickup curve: this year up to today, last year once booking dates are trusted', () => {
  const { db, model } = setup();
  seedImport(db);
  insert(db, { startDate: '2025-12-05', endDate: '2025-12-07', createdAt: '2025-10-01 10:00:00' });
  insert(db, { startDate: '2026-12-05', endDate: '2026-12-07', createdAt: '2026-08-15 10:00:00' });
  const { data } = model.getPaceMonth('2026-12', { today: TODAY });
  assert.equal(data.todayDaysBefore, 62);
  assert.equal(data.points[0].daysBefore, 365);
  assert.equal(data.points.at(-1).daysBefore, 0);
  const at = (d) => data.points.find((p) => p.daysBefore === d);
  assert.equal(at(65).current, 1);
  assert.equal(at(110).current, 0);
  assert.equal(at(60).current, null);
  assert.equal(at(65).lastYear, 0);
  assert.equal(at(60).lastYear, 1);
});

test('§5 — an approved iCal cancellation writes the ledger and keeps counting before it', () => {
  const { db, get } = setup();
  seedImport(db);
  db.exec(`
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, name TEXT, emptyFeedStreak INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE ical_import_events (
      sourceId INTEGER, eventUid TEXT, reservationId INTEGER, eventHash TEXT,
      startDate TEXT, endDate TEXT, summaryNormalized TEXT, lastSeenAt TEXT, UNIQUE(sourceId, eventUid)
    );
    CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT);
    CREATE TABLE ical_cancellation_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, sourceId INTEGER, eventUid TEXT, detectedAt TEXT, acknowledgedAt TEXT, outcome TEXT);
  `);
  const id = insert(db, { startDate: '2026-11-10', endDate: '2026-11-13', createdAt: '2026-07-01 10:00:00', balanceAmount: 300, platformCommissionAmount: 45 });
  db.prepare('INSERT INTO ical_cancellation_alerts (id, reservationId, sourceId, eventUid) VALUES (1, ?, 1, ?)').run(id, 'E1');
  const result = icalCancellationModel.buildModel(db).approve(1);
  assert.equal(result.outcome, 'approved');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE id = ?').get(id).n, 0);
  const ledger = db.prepare('SELECT * FROM booking_pace_cancellations').get();
  assert.deepEqual([ledger.reservationId, ledger.startDate, ledger.totalSejour, ledger.reservationCreatedAt], [id, '2026-11-10', 255, '2026-07-01 10:00:00']);
  assert.equal(ledger.cancelledAt.slice(0, 10), new Date().toISOString().slice(0, 10));
  // Pinned to the suite's « today » so the reading below does not depend on the day it runs.
  db.prepare("UPDATE booking_pace_cancellations SET cancelledAt = '2026-09-30 12:00:00'").run();
  // Cancelled today: no longer on the books today, but it was a month earlier.
  assert.equal(month(get().data, '2026-11').current, 0);
  const curve = bookingPaceModel.buildModel(db).getPaceMonth('2026-11', { today: TODAY }).data;
  assert.equal(curve.points.find((p) => p.daysBefore === 35).current, 1);
});

test('rule 4 — the logement filter applies; unknown metric, logement or month refused', () => {
  const { db, get, model } = setup();
  seedImport(db);
  insert(db, { propertyId: 2, startDate: '2026-10-10', endDate: '2026-10-12', createdAt: '2026-08-01 10:00:00' });
  assert.equal(month(get().data, '2026-10').current, 1);
  assert.equal(month(get({ propertyId: '1' }).data, '2026-10').current, 0);
  assert.equal(month(get({ propertyId: '2' }).data, '2026-10').current, 1);
  assert.deepEqual(get({ metric: 'adr' }), { ok: false, status: 400, error: 'Mesure inconnue.' });
  assert.deepEqual(get({ propertyId: '99' }), { ok: false, status: 400, error: 'Logement inconnu.' });
  assert.deepEqual(model.getPaceMonth('2026-13', {}), { ok: false, status: 400, error: 'Mois invalide.' });
});
