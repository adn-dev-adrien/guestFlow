// specs/pricing-components.md §3 rules 31 and 37 — a line moved to the arrival is collected by the arrival complement: the moment the line
// says (« À payer à l’arrivée ») and the bucket that collects it (`saleDetail.buckets.arrival`, the stored complement) are one, on a stay
// that has started as on one that has not; the acompte and the solde never take it.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const model = require('../models/reservationsModel');
const extraSale = require('../utils/extraSale');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9401, 'Moments', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9401, 'Camille', 'Moment')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9401, 'Standard', 100)").run();
const optionId = (title, price) => {
  const id = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES (?, ?, 'per_stay')").run(title, price).lastInsertRowid);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9401, ?)').run(id);
  return id;
};
const bath = optionId('Bain nordique', 40);
const wine = optionId('Panier vin', 25);

function stayStarting(offsetDays) {
  const startDate = addDaysToIsoDate(todayIso(), offsetDays);
  const endDate = addDaysToIsoDate(startDate, 4);
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime, balanceDueDate)
    VALUES (9401, 9401, ?, ?, 'direct', 2, 400, 400, 'reservation', '15:00', ?)`).run(startDate, endDate, startDate).lastInsertRowid);
}
const lineOf = (detail, label) => detail.lines.find((line) => line.label === label);
const stored = (id) => db.prepare('SELECT complementAmount, balanceAmount, endOfStayComplementAmount FROM reservations WHERE id = ?').get(id);

test('rule 31 — on a started stay, « Percevoir maintenant » puts the line in the arrival bucket, not in the solde', () => {
  const id = stayStarting(-1);
  extraSale.sell(id, [{ articleRef: `option:${bath}`, quantity: 1 }]);
  extraSale.sell(id, [{ articleRef: `option:${wine}`, quantity: 1 }]);
  const before = extraSale.saleDetailOf(id);
  assert.deepEqual(before.buckets, { plan: 40000, arrival: 0, departure: 6500 });
  const moved = extraSale.changeLine(id, lineOf(before, 'Bain nordique').ref, { collectAt: 'arrival' });
  assert.equal(moved.status, 200);
  assert.equal(lineOf(moved.saleDetail, 'Bain nordique').status, 'dueAtArrival');
  assert.deepEqual(moved.saleDetail.buckets, { plan: 40000, arrival: 4000, departure: 2500 });
  assert.deepEqual(stored(id), { complementAmount: 40, balanceAmount: 400, endOfStayComplementAmount: 25 });
});

test('rule 31 — the arrival SAS run after the move keeps the line in the complement it collects', () => {
  const id = stayStarting(-1);
  extraSale.sell(id, [{ articleRef: `option:${bath}`, quantity: 1 }]);
  extraSale.changeLine(id, lineOf(extraSale.saleDetailOf(id), 'Bain nordique').ref, { collectAt: 'arrival' });
  const plan = model.planArrivalSas(id, {});
  assert.equal(plan.arrivalComplementTotal, 40);
  assert.ok(plan.lines.some((line) => line.group === 'existing' && line.label === 'Bain nordique' && line.billed === 40));
  model.commitArrivalSas(id, { complementItems: [] });
  assert.equal(stored(id).complementAmount, 40);
  assert.equal(extraSale.saleDetailOf(id).buckets.arrival, 4000);
});

test('rule 37 — moved back to the departure, the line leaves the arrival bucket again', () => {
  const id = stayStarting(-1);
  extraSale.sell(id, [{ articleRef: `option:${bath}`, quantity: 1 }]);
  const ref = lineOf(extraSale.saleDetailOf(id), 'Bain nordique').ref;
  extraSale.changeLine(id, ref, { collectAt: 'arrival' });
  const back = extraSale.changeLine(id, ref, { collectAt: 'departure' });
  assert.equal(back.status, 200);
  assert.deepEqual(back.saleDetail.buckets, { plan: 40000, arrival: 0, departure: 4000 });
  assert.equal(lineOf(back.saleDetail, 'Bain nordique').status, 'dueAtDeparture');
});

test('rule 31 — on a stay not started, a sale is already in the arrival bucket (unchanged)', () => {
  const id = stayStarting(5);
  extraSale.sell(id, [{ articleRef: `option:${bath}`, quantity: 1 }]);
  const detail = extraSale.saleDetailOf(id);
  assert.equal(lineOf(detail, 'Bain nordique').status, 'dueAtArrival');
  assert.equal(detail.buckets.arrival, 4000);
});
