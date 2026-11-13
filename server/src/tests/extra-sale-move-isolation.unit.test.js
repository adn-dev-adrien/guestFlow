// specs/pricing-components.md §3 rule 37 — moving one line to the arrival leaves every other line where it was, and a refused move says
// that a move is refused (never the wording of a removal).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9301, 'Mouvements', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9301, 'Camille', 'Mouvement')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9301, 'Standard', 100)").run();
const optionId = (title, price) => {
  const id = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES (?, ?, 'per_stay')").run(title, price).lastInsertRowid);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9301, ?)').run(id);
  return id;
};
const bath = optionId('Bain nordique', 40);
const wine = optionId('Panier vin', 25);
const bread = optionId('Pain frais', 6);

function startedStay() {
  const startDate = addDaysToIsoDate(todayIso(), -1);
  const endDate = addDaysToIsoDate(startDate, 4);
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime, balanceDueDate)
    VALUES (9301, 9301, ?, ?, 'direct', 2, 400, 400, 'reservation', '15:00', ?)`).run(startDate, endDate, startDate).lastInsertRowid);
}
const lineOf = (detail, label) => detail.lines.find((line) => line.label === label);

test('rule 37 — « Percevoir maintenant » on one departure line leaves the other departure lines at the departure', () => {
  const id = startedStay();
  extraSale.sell(id, [{ articleRef: `option:${bath}`, quantity: 1 }]);
  extraSale.sell(id, [{ articleRef: `option:${wine}`, quantity: 1 }]);
  const before = extraSale.saleDetailOf(id);
  assert.deepEqual(['Bain nordique', 'Panier vin'].map((l) => lineOf(before, l).collectAt), ['departure', 'departure']);
  const moved = extraSale.changeLine(id, lineOf(before, 'Bain nordique').ref, { collectAt: 'arrival' });
  assert.equal(moved.status, 200);
  assert.equal(lineOf(moved.saleDetail, 'Bain nordique').collectAt, 'arrival');
  assert.equal(lineOf(moved.saleDetail, 'Panier vin').collectAt, 'departure');
  assert.equal(moved.saleDetail.buckets.departure, 2500);
});

test('rule 37 — the same, on a stay whose baseline is stored and holds a line sold before the stay started', () => {
  const id = startedStay();
  extraSale.sell(id, [{ articleRef: `option:${bread}`, quantity: 1 }]);
  extraSale.sell(id, [{ articleRef: `option:${wine}`, quantity: 1 }]);
  extraSale.sell(id, [{ articleRef: `option:${bath}`, quantity: 1 }]);
  const detail = extraSale.saleDetailOf(id);
  const moved = extraSale.changeLine(id, lineOf(detail, 'Panier vin').ref, { collectAt: 'arrival' });
  assert.equal(moved.status, 200);
  assert.deepEqual(['Pain frais', 'Panier vin', 'Bain nordique'].map((l) => lineOf(moved.saleDetail, l).collectAt), ['departure', 'arrival', 'departure']);
});
test('rule 37 — a move the fiche\'s save refuses as a lowered arrival line is told as a move, not as a removal', () => {
  const id = startedStay();
  extraSale.sell(id, [{ articleRef: `option:${bath}`, quantity: 1 }]);
  const controller = require('../controllers/reservationsController');
  const { performUpdate } = controller;
  controller.performUpdate = () => ({ status: 400, body: { error: 'Une prestation vendue à l\'arrivée ne peut être ni retirée ni réduite.', code: 'ARRIVAL_EXTRAS_FROZEN', lines: [] } });
  try {
    const refused = extraSale.changeLine(id, lineOf(extraSale.saleDetailOf(id), 'Bain nordique').ref, { collectAt: 'arrival' });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'MOMENT_NOT_AVAILABLE');
    assert.doesNotMatch(refused.body.error, /retirée|réduite/);
    assert.match(refused.body.error, /changer de moment/);
  } finally {
    controller.performUpdate = performUpdate;
  }
  assert.equal(lineOf(extraSale.saleDetailOf(id), 'Bain nordique').collectAt, 'departure');
});
