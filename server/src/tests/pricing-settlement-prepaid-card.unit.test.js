// specs/pricing-components.md §3 rules 21, 31 (class E8) — a card-paid line (a settled note that names it) is netted out of the arrival
// complement and the pre-arrival split even when the stay has no arrival baseline yet (the arrival day before the check-in hour,
// rule 19): the money the guest already paid is not asked a second time, and the lines nobody paid are untouched.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitMidStayExtras, resolveMidStaySplit } = require('../utils/pricing/settlement');

const line = (optionId, totalPrice, inComplement = 1) => ({ optionId, title: `Option ${optionId}`, totalPrice, unitPrice: totalPrice, billedUnits: 1, inComplement });
const note = (key, amount) => [{ id: 1, total: amount, lines: [{ key, amount }] }];

test('rule 31 — no baseline and no note: nothing is mid-stay, as before', () => {
  assert.equal(splitMidStayExtras([line(3, 40)], null, null).total, 0);
});

test('rule 31 — no baseline, a card note on one line: that line leaves the arrival complement, the others stay', () => {
  const split = splitMidStayExtras([line(3, 40), line(4, 25)], null, note('opt:3', 40));
  assert.equal(split.total, 40);
  assert.equal(split.forced, 40);
  assert.equal(split.settledTotal, 40);
  assert.equal(split.remainingTotal, 0);
  assert.deepEqual(Object.keys(split.byKey), ['opt:3']);
});

test('rule 31 — a note below the line\'s total nets only what it collected', () => {
  const split = splitMidStayExtras([line(3, 40)], null, note('opt:3', 15));
  assert.deepEqual([split.total, split.settledTotal, split.remainingTotal], [15, 15, 0]);
});

test('rule 31 — a stored baseline wins, the note nets what is above it (unchanged)', () => {
  const split = splitMidStayExtras([line(3, 40)], { 'opt:3': 10 }, note('opt:3', 30));
  assert.deepEqual([split.total, split.settledTotal, split.remainingTotal], [30, 30, 0]);
});

test('rule 21 — a collected end-of-stay complement is read back from its stored lines, not from the derived baseline', () => {
  const split = resolveMidStaySplit([line(3, 40)], { baseline: null, settled: true, storedLines: [], notes: note('opt:3', 40) });
  assert.equal(split.remainingTotal, 0);
});

test('rules 21, 31 — end to end: a sale card-paid on a stay not started asks nothing more at arrival', () => {
  const db = require('../database');
  const extraSale = require('../utils/extraSale');
  const { quoteStoredReservation } = require('../utils/storedReservationQuote');
  const { todayIso } = require('../utils/localDate');
  const { addDaysToIsoDate } = require('../utils/devisHelpers');
  db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9501, 'Carte', 8, 0)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9501, 'Camille', 'Carte')").run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9501, 'Standard', 100)").run();
  const bath = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Bain nordique', 40, 'per_stay')").run().lastInsertRowid);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9501, ?)').run(bath);
  const start = addDaysToIsoDate(todayIso(), 20);
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime)
    VALUES (9501, 9501, ?, ?, 'direct', 2, 300, 300, 'reservation', '15:00')`).run(start, addDaysToIsoDate(start, 3)).lastInsertRowid);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${bath}`, quantity: 1 }], { source: 'fiche' }).status, 200);
  const row = () => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  assert.equal(quoteStoredReservation(db, row()).complementAmount, 40);
  const noted = [{ id: 1, total: 40, paidDate: todayIso(), paidCash: 0, lines: [{ key: `opt:${bath}`, amount: 40 }] }];
  db.prepare('UPDATE reservations SET midStaySettledNotes = ? WHERE id = ?').run(JSON.stringify(noted), id);
  const quote = quoteStoredReservation(db, row());
  assert.equal(quote.complementAmount, 0);
  assert.equal(quote.midStayRemainingTotal, 0);
  assert.equal(quote.midStaySettledTotal, 40);
});
