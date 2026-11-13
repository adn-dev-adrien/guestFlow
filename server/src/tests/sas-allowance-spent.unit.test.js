// specs/pricing-components.md §3 rules 26 and 41 — the arrival SAS spends the stay's free units as the fiche's engine does (class C-E4):
// a sale of an article with a grant left is priced net of it, its line stores what it consumed (`allowanceUsed`), and every later save
// reads that fact — the line is never discounted a second time, and a later sale of the article finds the grant spent.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, controller, createStay, seed,
} = require('./ledgerFixture');
const model = require('../models/reservationsModel');
const extraSale = require('../utils/extraSale');
const { toUpdateBody } = require('../utils/reservationUpdateBody');

seed();
const BASKET = 203;
db.prepare("INSERT INTO options (id, title, price, priceType, category) VALUES (?, 'Panier', 8, 'per_stay', 'Restauration')").run(BASKET);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(BASKET);
db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, ?, 8, 2)').run(BASKET);

const lines = (id) => db.prepare('SELECT quantity, totalPrice, allowanceUsed FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(id, BASKET);
const complement = (id) => db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(id).complementAmount;
const sellAtSas = (id, units) => model.commitArrivalSas(id, { soldOptions: [{ optionId: BASKET, units }] });
const save = (id) => {
  const result = controller.performUpdate(String(id), toUpdateBody(model.getByIdWithDetails(id)));
  assert.equal(result.status, 200, JSON.stringify(result.body));
};

test('rule 41 — three baskets sold at the SAS, two free: the line bills one and stores the two it consumed', () => {
  const id = createStay();
  const plan = model.planArrivalSas(id, { soldOptions: [{ optionId: BASKET, units: 3 }] });
  assert.equal(plan.lines.find((line) => line.optionId === BASKET).billed, 8);
  sellAtSas(id, 3);
  assert.deepEqual(lines(id).map((l) => [l.quantity, l.totalPrice, JSON.parse(l.allowanceUsed)]), [[3, 8, { freeUnits: 2, amount: 16 }]]);
  assert.equal(complement(id), 8);
});

test('rule 26 — the fiche saves after the SAS never discount the line a second time', () => {
  const id = createStay();
  sellAtSas(id, 3);
  save(id);
  save(id);
  assert.deepEqual(lines(id).map((l) => l.totalPrice), [8]);
  assert.equal(complement(id), 8);
});

test('rule 41 — the fiche sells the article again: the grant is already spent, the SAS line keeps its price', () => {
  const id = createStay();
  sellAtSas(id, 3);
  const sold = extraSale.sell(id, [{ articleRef: `option:${BASKET}`, quantity: 1 }]);
  assert.equal(sold.status, 200);
  assert.deepEqual(lines(id).map((l) => [l.totalPrice, l.allowanceUsed && JSON.parse(l.allowanceUsed).freeUnits]), [[8, 2], [8, 0]]);  // rule 26: a line sold after the stay was sold stores what it consumed, 0 included
  assert.equal(complement(id), 16);
});

test('rule 41 — a reopened SAS sending the same sale prices it the same way', () => {
  const id = createStay();
  sellAtSas(id, 3);
  sellAtSas(id, 3);
  assert.deepEqual(lines(id).map((l) => l.totalPrice), [8]);
  assert.equal(complement(id), 8);
});

test('rule 41 — one basket sold: it is free, and its line stores the one unit it consumed', () => {
  const id = createStay();
  sellAtSas(id, 1);
  assert.deepEqual(lines(id).map((l) => [l.totalPrice, JSON.parse(l.allowanceUsed).freeUnits]), [[0, 1]]);
});

test('rule 41 — a platform stay has no free unit: the SAS bills every basket', () => {
  const id = createStay({ platform: 'Booking' });
  sellAtSas(id, 3);
  assert.deepEqual(lines(id).map((l) => [l.totalPrice, l.allowanceUsed]), [[24, null]]);
});

test('rule 41 — the stored-stay quote (installments, contributions, tax, saleDetail buckets) reads the same consumption as the fiche save', () => {
  const id = createStay();
  sellAtSas(id, 3);
  const { quoteStoredReservation } = require('../utils/storedReservationQuote');
  const quote = quoteStoredReservation(db, model.getRow(id));
  assert.deepEqual(quote.optionLines.filter((l) => Number(l.optionId) === BASKET).map((l) => l.totalPrice), [8]);
});
