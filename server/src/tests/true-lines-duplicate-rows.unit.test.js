// specs/pricing-components.md §3 rules 13 and 85 (line key scheme) — a database that already holds TWO rows of one article on one stay
// (the line tables lost their article key): every path that addresses a line by its article touches exactly the intended row(s), and every
// reader returns every row. One block per path, cited by its inventory class (LINE moved to lineId, AGG aggregated on purpose).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
const { calculateReservationQuote } = require('../utils/pricing');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const { todayIso } = require('../utils/localDate');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9301, 'Doublons', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9301, 'Camille', 'Doublon')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9301, 'Standard', 100)").run();
const optionId = (title, price, priceType = 'per_stay') => {
  const id = Number(db.prepare('INSERT INTO options (title, price, priceType) VALUES (?, ?, ?)').run(title, price, priceType).lastInsertRowid);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9301, ?)').run(id);
  return id;
};
const bath = optionId('Bain nordique', 40);
const wine = optionId('Panier vin', 25);

// A stay holding two rows of `bath`: the first sold at 40, the second (a later sale) at 45 × 2 = 90, plus one row of `wine`.
function stayWithTwoSales({ startOffset = 20 } = {}) {
  const startDate = addDaysToIsoDate(todayIso(), startOffset);
  const endDate = addDaysToIsoDate(startDate, 3);
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime)
    VALUES (9301, 9301, ?, ?, 'direct', 2, 300, 430, 'reservation', '15:00')`).run(startDate, endDate).lastInsertRowid);
  const insert = db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice)
    VALUES (?, ?, ?, ?, ?, 'per_stay', ?)`);
  insert.run(id, bath, 1, 40, 1, 40);
  insert.run(id, bath, 2, 45, 2, 90);
  insert.run(id, wine, 1, 25, 1, 25);
  return id;
}
const rowsOf = (id) => db.prepare('SELECT lineId, optionId, quantity, totalPrice, offered, acompteContribTtc, soldeContribTtc FROM reservation_options WHERE reservationId = ? ORDER BY lineId').all(id);
const quoteOf = (id) => calculateReservationQuote(buildReservationEngineInput(db, db.prepare('SELECT * FROM reservations WHERE id = ?').get(id)));

test('rule 85 — the fixture really holds two rows of one article on one stay', () => {
  const id = stayWithTwoSales();
  assert.deepEqual(rowsOf(id).map((r) => [r.optionId, r.totalPrice]), [[bath, 40], [bath, 90], [wine, 25]]);
});

test('rule 85 (engine) — each stored row prices from its OWN snapshot; the first keeps the legacy key, the later one is named by its line', () => {
  const id = stayWithTwoSales();
  const [first, second] = rowsOf(id);
  const lines = quoteOf(id).optionLines.filter((l) => l.optionId === bath).sort((a, b) => a.totalPrice - b.totalPrice);
  assert.deepEqual(lines.map((l) => l.totalPrice), [40, 90], 'neither line took the other one\'s snapshot');
  assert.equal(lines[0].lineKey, undefined, 'the first line of the article is unchanged: no new field, legacy key');
  assert.equal(lines[1].lineKey, `line:reservation_options:${second.lineId}`);
  assert.equal(lines[1].lineId, second.lineId);
  assert.ok(first.lineId < second.lineId);
});

test('rule 85 (lineFacts, allocations, refunds) — each row has its own key: the first the legacy one, the later one its line ref', () => {
  const id = stayWithTwoSales();
  const [first, second] = rowsOf(id);
  db.prepare('UPDATE reservation_options SET discountCents = 500 WHERE lineId = ?').run(second.lineId);
  const facts = require('../models/ports/stayRepository').create(db).lineFacts(id);
  assert.equal(facts[`opt:${bath}`].lineId, first.lineId);
  assert.equal(facts[`opt:${bath}`].discountCents, 0);
  assert.equal(facts[`line:reservation_options:${second.lineId}`].discountCents, 500, 'the second row\'s fact is no longer dropped');
  const { lineRefsByKey } = require('../utils/paymentAllocationsSync');
  const refs = lineRefsByKey(db, id);
  assert.equal(refs.get(`opt:${bath}`), `line:reservation_options:${first.lineId}`);
  assert.equal(refs.get(`line:reservation_options:${second.lineId}`), `line:reservation_options:${second.lineId}`);
  const { isResourceKey } = require('../utils/pricing/lineKeys');
  assert.deepEqual(['res:3', 'line:reservation_resources:9', 'opt:3', 'line:reservation_options:9'].map(isResourceKey), [true, true, false, false]);
});

test('rule 85 (LINE: forceItemContribsCapture) — the stored split and the capture write each row its own share, never the last row\'s over the first', () => {
  const id = stayWithTwoSales();
  const [first, second] = rowsOf(id);
  const { captureStoredSplit } = require('../utils/forceItemContribsCapture');
  db.prepare('UPDATE reservations SET depositAmount = 130, depositPaid = 1 WHERE id = ?').run(id);
  captureStoredSplit({ db, reservation: db.prepare('SELECT * FROM reservations WHERE id = ?').get(id), bucket: 'deposit' });
  const shares = Object.fromEntries(rowsOf(id).map((r) => [r.lineId, r.acompteContribTtc]));
  assert.ok(shares[first.lineId] > 0 && shares[second.lineId] > 0);
  assert.notEqual(shares[first.lineId], shares[second.lineId], 'the two rows hold different shares (40 vs 90)');
  assert.ok(Math.abs(shares[second.lineId] / shares[first.lineId] - 90 / 40) < 0.05, 'in proportion to what each row is owed');
});

test('rule 85 (LINE: storedLineContribs) — a later sale takes the contribs of ITS stored row', () => {
  const { withStoredLineContribs } = require('../utils/storedLineContribs');
  const quote = { optionLines: [{ optionId: 5, totalPrice: 40 }, { optionId: 5, lineId: 9, lineKey: 'line:reservation_options:9', totalPrice: 90 }], resourceLines: [] };
  const stored = [{ lineId: 4, optionId: 5, acompteContribTtc: 10, soldeContribTtc: 30 }, { lineId: 9, optionId: 5, acompteContribTtc: 20, soldeContribTtc: 70 }];
  const out = withStoredLineContribs(quote, { lockedOptionLines: stored, lockedResourceLines: [] }).optionLines;
  assert.deepEqual(out.map((l) => [l.acompteContribTtc, l.soldeContribTtc]), [[10, 30], [20, 70]]);
});
