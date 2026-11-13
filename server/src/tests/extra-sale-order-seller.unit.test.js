// specs/pricing-components.md §3 rules 26, 29, 92 — what a seller that keeps its own row (the guest app) asks of `extraSale`: a line that takes none of the
// article's free units and says so, a card sale paid before the arrival written already settled and never above what was paid, the order a line belongs
// to, a waiting order's lines priced before a reader's view, and where a sale taken now is collected.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const extraSale = require('../utils/extraSale');
const { quoteStoredReservation } = require('../utils/storedReservationQuote');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9601, 'Vente', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9601, 'Camille', 'Vente')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9601, 'Standard', 100)").run();
const cider = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Cidre vente', 10, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9601, ?)').run(cider);
db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (9601, ?, 10, 2)').run(cider);

const stay = (daysAhead = 20) => {
  const start = addDaysToIsoDate(todayIso(), daysAhead);
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime)
    VALUES (9601, 9601, ?, ?, 'direct', 2, 300, 300, 'reservation', '15:00')`).run(start, addDaysToIsoDate(start, 3)).lastInsertRowid);
};
const request = (extra = {}) => [{ articleRef: `option:${cider}`, quantity: 1, ...extra }];
const lineOf = (id) => db.prepare('SELECT * FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId DESC').get(id, cider);

test('rules 26, 92 — a line sold with `noFreeUnits` takes none of the article\'s free units and stores that it consumed none', () => {
  const free = stay();
  const taken = extraSale.sell(free, request(), { source: 'shop' });
  assert.equal(taken.status, 200, JSON.stringify(taken.body));
  assert.equal(taken.totalCents, 0, 'the stay was granted 2 free units: the first sale is covered');
  const billed = stay();
  const sold = extraSale.sell(billed, request({ noFreeUnits: true }), { source: 'shop' });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.equal(sold.totalCents, 1000, 'the units are already in place: billed from the first');
  assert.deepEqual(JSON.parse(lineOf(billed).allowanceUsed), { freeUnits: 0, amount: 0 });
  assert.equal(extraSale.quote(stay(), request({ noFreeUnits: true })).totalCents, 1000, 'the quote says the same');
});

test('rules 13, 29, 92 — a card sale paid before the arrival is written settled, stamped with its order, and the arrival complement owes nothing for it', () => {
  const id = stay();
  const sold = extraSale.sell(id, request({ noFreeUnits: true }), {
    source: 'shop', orderRef: 'order:7', paid: { amountCents: 1000, paidDate: todayIso(), reference: 'pay_1', ref: '7', source: 'guestOrder' },
  });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.deepEqual([sold.settledCents, sold.overpaidCents, sold.collectAt, sold.orderRef], [1000, 0, 'arrival', 'order:7']);
  assert.equal(lineOf(id).orderRef, 'order:7:1');
  assert.equal(lineOf(id).source, 'shop');
  const note = JSON.parse(db.prepare('SELECT midStaySettledNotes FROM reservations WHERE id = ?').get(id).midStaySettledNotes)[0];
  assert.deepEqual([note.total, note.ref, note.source, note.reference, note.method], [10, '7', 'guestOrder', 'pay_1', 'card']);
  assert.equal(quoteStoredReservation(db, db.prepare('SELECT * FROM reservations WHERE id = ?').get(id)).complementAmount, 0);
  const detail = extraSale.saleDetailOf(id).lines.find((line) => line.label === 'Cidre vente');
  assert.deepEqual([detail.status, detail.settledCents], ['paid', 1000]);
});

test('rule 29 — a payment above the sale leaves the gap owed back; a price that rose beyond the payment is refused and nothing is written', () => {
  const id = stay();
  const above = extraSale.sell(id, request({ noFreeUnits: true }), { source: 'shop', orderRef: 'order:8', paid: { amountCents: 1300, paidDate: todayIso(), ref: '8' } });
  assert.deepEqual([above.status, above.settledCents, above.overpaidCents], [200, 1000, 300]);
  const other = stay();
  const before = db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ?').get(other).n;
  const rose = extraSale.sell(other, request({ noFreeUnits: true }), { source: 'shop', orderRef: 'order:9', paid: { amountCents: 800, paidDate: todayIso(), ref: '9' } });
  assert.deepEqual([rose.status, rose.body.code, rose.body.totalCents], [409, 'PRICE_ROSE', 1000]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ?').get(other).n, before, 'nothing written');
});

test('rules 26, 92 — a reader\'s quote after a waiting order prices after that order\'s lines, writes nothing', () => {
  const id = stay();
  const waiting = [{ kind: 'option', id: cider, quantity: 2 }];
  assert.equal(extraSale.quote(id, request()).totalCents, 0, 'alone: the first unit is covered by the free units');
  assert.equal(extraSale.quote(id, request(), { pending: waiting }).totalCents, 1000, 'after the waiting order, which holds both free units');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ?').get(id).n, 0);
});

test('rule 20 and guest-app rule 104 — where a sale taken now is collected: the arrival before the clock reaches it, the departure after, closed once collected', () => {
  const ahead = stay(5);
  assert.equal(extraSale.collectionOf(ahead, new Date()), 'arrival');
  const started = stay(-1);
  assert.equal(extraSale.collectionOf(started, new Date()), 'departure');
  db.prepare('UPDATE reservations SET endOfStayComplementPaid = 1 WHERE id = ?').run(started);
  assert.equal(extraSale.collectionOf(started, new Date()), 'closed');
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(ahead);
  assert.equal(extraSale.collectionOf(ahead, new Date()), 'closed');
});
