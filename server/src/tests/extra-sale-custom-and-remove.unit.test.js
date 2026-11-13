// specs/pricing-components.md §3 rules 25, 26, 27 and 85 — the line API sells a line that is no article (`articleRef: 'custom'`: linen pieces, a
// plugin's supplement) and takes an unpaid line off the stay (`removeLine`), both through the fiche's own save; a paid line is offered, never removed.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9501, 'Lignes', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9501, 'Camille', 'Ligne')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9501, 'Standard', 100)").run();
const optionId = (title, price, freeUnits = 0) => {
  const id = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES (?, ?, 'per_stay')").run(title, price).lastInsertRowid);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9501, ?)').run(id);
  if (freeUnits) db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (9501, ?, ?, ?)').run(id, price, freeUnits);
  return id;
};
const wine = optionId('Panier vin', 25);
const bread = optionId('Pain frais', 6, 2);

function stayStarting(offsetDays) {
  const startDate = addDaysToIsoDate(todayIso(), offsetDays);
  const endDate = addDaysToIsoDate(startDate, 4);
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime, balanceDueDate)
    VALUES (9501, 9501, ?, ?, 'direct', 2, 400, 400, 'reservation', '15:00', ?)`).run(startDate, endDate, startDate).lastInsertRowid);
}
const lineOf = (detail, label) => detail.lines.find((line) => line.label === label);
const customRows = (id) => db.prepare('SELECT description, amount, quantity, inComplement, source, collectAt FROM reservation_custom_options WHERE reservationId = ? ORDER BY lineId').all(id);

test('rule 25 — a custom line is quoted and sold: its own text and total, routed like any new line', () => {
  const id = stayStarting(5);
  const quoted = extraSale.quote(id, [{ articleRef: 'custom', label: "Taie d'oreiller", amount: 6.6, quantity: 2 }]);
  assert.equal(quoted.status, 200);
  assert.deepEqual(quoted.lines.map((l) => [l.articleRef, l.totalCents, l.collectAt]), [['custom', 660, 'arrival']]);
  assert.equal(quoted.buckets.arrival, 660);
  const sold = extraSale.sell(id, [{ articleRef: 'custom', label: "Taie d'oreiller", amount: 6.6, quantity: 2 }], { source: 'sas' });
  assert.equal(sold.status, 200);
  assert.deepEqual(customRows(id), [{ description: "Taie d'oreiller", amount: 6.6, quantity: 2, inComplement: 1, source: 'sas', collectAt: 'arrival' }]);
  assert.equal(sold.saleDetail.buckets.arrival, 660);
  assert.equal(lineOf(sold.saleDetail, "Taie d'oreiller").kind, 'custom');
});

test('rule 85 — the same text sold twice is two lines', () => {
  const id = stayStarting(5);
  extraSale.sell(id, [{ articleRef: 'custom', label: 'Drap', amount: 12 }]);
  extraSale.sell(id, [{ articleRef: 'custom', label: 'Drap', amount: 12 }]);
  assert.equal(customRows(id).length, 2);
  assert.equal(extraSale.saleDetailOf(id).buckets.arrival, 2400);
});

test('rule 25 — a custom request without a text, a positive amount or a whole count is refused', () => {
  const id = stayStarting(5);
  for (const request of [{ label: '', amount: 3 }, { label: 'Drap', amount: 0 }, { label: 'Drap', amount: 3, quantity: 1.5 }]) {
    const refused = extraSale.quote(id, [{ articleRef: 'custom', ...request }]);
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, 'INVALID_REQUEST');
  }
});

test('rule 25 — on a started stay a custom line sold now is collected at the departure', () => {
  const id = stayStarting(-1);
  const sold = extraSale.sell(id, [{ articleRef: 'custom', label: 'Bois de chauffage', amount: 15 }]);
  assert.equal(sold.status, 200);
  assert.equal(lineOf(sold.saleDetail, 'Bois de chauffage').collectAt, 'departure');
  assert.equal(sold.saleDetail.buckets.departure, 1500);
});

test('rule 25 — an unpaid line is removed: the stay no longer bills it, the other lines stay', () => {
  const id = stayStarting(5);
  extraSale.sell(id, [{ articleRef: `option:${wine}`, quantity: 1 }]);
  extraSale.sell(id, [{ articleRef: 'custom', label: 'Drap', amount: 12 }]);
  const before = extraSale.saleDetailOf(id);
  assert.equal(before.buckets.arrival, 3700);
  const removed = extraSale.removeLine(id, lineOf(before, 'Panier vin').ref);
  assert.equal(removed.status, 200);
  assert.equal(lineOf(removed.saleDetail, 'Panier vin'), undefined);
  assert.equal(removed.saleDetail.buckets.arrival, 1200);
  const custom = extraSale.removeLine(id, lineOf(removed.saleDetail, 'Drap').ref);
  assert.equal(custom.status, 200);
  assert.equal(custom.saleDetail.buckets.arrival, 0);
  const journal = db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ?').all(id)
    .flatMap((row) => JSON.parse(row.changedFields)).filter((c) => c.field === 'lineRemoved');
  assert.deepEqual(journal.map((c) => [c.label, c.from]), [['Panier vin', '25,00 €'], ['Drap', '12,00 €']]);
});

test('rule 85 — removing the second line of an article leaves the first', () => {
  const id = stayStarting(5);
  extraSale.sell(id, [{ articleRef: `option:${wine}`, quantity: 1 }]);
  extraSale.sell(id, [{ articleRef: `option:${wine}`, quantity: 2 }]);
  const lines = extraSale.saleDetailOf(id).lines.filter((l) => l.label === 'Panier vin');
  assert.equal(lines.length, 2);
  const removed = extraSale.removeLine(id, lines[1].ref);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.saleDetail.lines.filter((l) => l.label === 'Panier vin').map((l) => [l.ref, l.totalCents]), [[lines[0].ref, 2500]]);
});

test('rule 26 — a removed line gives its free units back: the next sale of the article gets them', () => {
  const id = stayStarting(5);
  extraSale.sell(id, [{ articleRef: `option:${bread}`, quantity: 3 }]);
  const first = lineOf(extraSale.saleDetailOf(id), 'Pain frais');
  assert.equal(first.totalCents, 600);
  extraSale.removeLine(id, first.ref);
  const again = extraSale.sell(id, [{ articleRef: `option:${bread}`, quantity: 2 }]);
  assert.equal(lineOf(again.saleDetail, 'Pain frais').totalCents, 0);
});

test('rule 23 — a paid line is not removed (409 LINE_PAID), an unknown one is 404', () => {
  const id = stayStarting(-1);
  const sold = extraSale.sell(id, [{ articleRef: `option:${wine}`, quantity: 1 }], { payment: 'cash' });
  assert.equal(sold.status, 200);
  const refused = extraSale.removeLine(id, lineOf(sold.saleDetail, 'Panier vin').ref);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'LINE_PAID');
  assert.equal(lineOf(extraSale.saleDetailOf(id), 'Panier vin').status, 'paid');
  assert.equal(extraSale.removeLine(id, 'option:999999').status, 404);
});

test('rule 79 — removing the first of two lines of the same text leaves the second with its own identity and amount', () => {
  const id = stayStarting(5);
  extraSale.sell(id, [{ articleRef: 'custom', label: 'Drap', amount: 12 }], { source: 'sas' });
  extraSale.sell(id, [{ articleRef: 'custom', label: 'Drap', amount: 15 }], { source: 'fiche' });
  const [first, second] = db.prepare("SELECT lineId, amount, source FROM reservation_custom_options WHERE reservationId = ? ORDER BY lineId").all(id);
  const removed = extraSale.removeLine(id, `custom:${first.lineId}`);
  assert.equal(removed.status, 200);
  assert.deepEqual(db.prepare('SELECT lineId, amount, source FROM reservation_custom_options WHERE reservationId = ?').all(id), [second]);
});
