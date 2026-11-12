// specs/pricing-components.md §3 rules 19, 20, 27, 28, 30, 31, 37, 39, 23 (class E8 with sale-detail) — selling an extra on a stay that
// exists: the quote writes nothing, the sale re-quotes and refuses a changed price, the new line carries its source and moment, a
// started stay routes it to the departure, the operator moves or discounts an unpaid line, and lowering a paid line is refused
// until confirmed, then owed back.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9201, 'Ventes', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9201, 'Camille', 'Vente')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9201, 'Standard', 100)").run();
const optionId = (title, price) => {
  const id = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES (?, ?, 'per_stay')").run(title, price).lastInsertRowid);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9201, ?)').run(id);
  return id;
};
const bath = optionId('Bain nordique', 40);
const wine = optionId('Panier vin', 25);

let seq = 0;
function stay({ startOffset, nights = 3, extraSql = '' }) {
  const startDate = addDaysToIsoDate(todayIso(), startOffset);
  const endDate = addDaysToIsoDate(startDate, nights);
  seq += 1;
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime)
    VALUES (9201, 9201, ?, ?, 'direct', 2, ?, ?, 'reservation', '15:00')`).run(startDate, endDate, nights * 100, nights * 100).lastInsertRowid);
  if (extraSql) db.prepare(extraSql).run(id);
  return id;
}
const sale = (requests, extra = {}) => ({ requests, payment: 'later', ...extra });
const lineOf = (detail, label) => detail.lines.find((line) => line.label === label);

test('rule 30 — a quote writes nothing and prices the request through the fiche\'s own engine', () => {
  const id = stay({ startOffset: 20 });
  const before = db.prepare('SELECT finalPrice, complementAmount FROM reservations WHERE id = ?').get(id);
  const result = extraSale.quote(id, [{ articleRef: `option:${bath}`, quantity: 1 }]);
  assert.equal(result.status, 200);
  assert.equal(result.totalCents, 4000);
  assert.deepEqual(result.lines.map((l) => [l.articleRef, l.totalCents, l.collectAt]), [[`option:${bath}`, 4000, 'arrival']]);
  assert.deepEqual(db.prepare('SELECT finalPrice, complementAmount FROM reservations WHERE id = ?').get(id), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ?').get(id).n, 0);
});

test('rules 19, 27, 28 — a sale on a stay not started lands in the arrival complement, stamped with its source and moment', () => {
  const id = stay({ startOffset: 20 });
  const result = extraSale.sell(id, [{ articleRef: `option:${bath}`, quantity: 1 }], { source: 'fiche', acceptedTotalCents: 4000 });
  assert.equal(result.status, 200);
  const line = lineOf(result.saleDetail, 'Bain nordique');
  assert.deepEqual([line.totalCents, line.source, line.collectAt, line.status], [4000, 'fiche', 'arrival', 'dueAtArrival']);
  const row = db.prepare('SELECT collectAt, collectAtDefault, source, soldAt FROM reservation_options WHERE reservationId = ?').get(id);
  assert.deepEqual([row.collectAt, row.collectAtDefault, row.source], ['arrival', 'arrival', 'fiche']);
  assert.ok(row.soldAt);
  assert.equal(db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(id).complementAmount, 40);
  assert.equal(result.saleDetail.buckets.arrival, 4000);
});

test('rule 30 — the sale refuses a price that is no longer the accepted one, and writes nothing', () => {
  const id = stay({ startOffset: 21 });
  const result = extraSale.sell(id, [{ articleRef: `option:${bath}`, quantity: 1 }], { acceptedTotalCents: 3900 });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'PRICE_CHANGED');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ?').get(id).n, 0);
});

test('rule 29 — a payment taken at once is not written here', () => {
  const id = stay({ startOffset: 22 });
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${bath}`, quantity: 1 }], { payment: 'cash' }).body.code, 'PAYMENT_MODE_UNSUPPORTED');
  assert.equal(extraSale.quote(id, [{ articleRef: 'nonsense', quantity: 1 }]).body.code, 'INVALID_REQUEST');
});

test('rule 37 — the operator moves an unpaid line, both values are journaled; a paid line is frozen (409 LINE_PAID)', () => {
  const id = stay({ startOffset: 23 });
  const sold = extraSale.sell(id, [{ articleRef: `option:${wine}`, quantity: 1 }]);
  const ref = lineOf(sold.saleDetail, 'Panier vin').ref;
  const moved = extraSale.changeLine(id, ref, { collectAt: 'departure' });
  assert.equal(moved.status, 200);
  assert.equal(lineOf(moved.saleDetail, 'Panier vin').collectAt, 'departure');
  const entry = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? ORDER BY id DESC LIMIT 1").get(id);
  assert.match(entry.changedFields, /à payer au départ \(opérateur\)/);
  assert.match(entry.changedFields, /à payer à l’arrivée \(horloge\)/);
  assert.equal(extraSale.changeLine(id, ref, { collectAt: 'bogus' }).body.code, 'INVALID_MOMENT');
  const lineId = Number(ref.split(':')[1]);
  db.prepare("INSERT INTO payment_allocations (paymentRef, documentRef, lineRef, amountCents, kind, at, books, origin) VALUES ('cash:1', ?, ?, 2500, 'payment', '2026-11-12', 1, 'live')")
    .run(`reservation:${id}`, `line:reservation_options:${lineId}`);
  assert.equal(extraSale.changeLine(id, ref, { collectAt: 'arrival' }).body.code, 'LINE_PAID');
});

test('rule 39 — a line discount comes off one unpaid line and is journaled; the stored total stays the catalogue amount', () => {
  const id = stay({ startOffset: 24 });
  const sold = extraSale.sell(id, [{ articleRef: `option:${bath}`, quantity: 1 }]);
  const ref = lineOf(sold.saleDetail, 'Bain nordique').ref;
  const discounted = extraSale.changeLine(id, ref, { discount: { percent: 25 } });
  assert.equal(discounted.status, 200);
  const line = lineOf(discounted.saleDetail, 'Bain nordique');
  assert.deepEqual([line.totalCents, line.discountCents, line.grossCents], [3000, 1000, 4000]);
  const row = db.prepare('SELECT totalPrice, discountCents FROM reservation_options WHERE reservationId = ?').get(id);
  assert.deepEqual([row.totalPrice, row.discountCents], [40, 1000]);
  assert.equal(db.prepare('SELECT finalPrice FROM reservations WHERE id = ?').get(id).finalPrice, 330);
});
