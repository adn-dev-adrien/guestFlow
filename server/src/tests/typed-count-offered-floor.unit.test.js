// An offered line sold at arrival keeps its floor on the count the field shows
// (specs/non-card-option-served-persons.md rule 27, audit R21-L2). Its `quantity` stays 1 and it bills 0 €, so neither
// the quantity nor the amount can see a reduction: only the typed count can.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const model = require('../models/reservationsModel');
const controller = require('../controllers/reservationsController');
const { toUpdateBody } = require('../utils/reservationUpdateBody');
const { todayIso } = require('../utils/localDate');
const { addIsoDays } = require('../utils/occupancy');
const { arrivalExtrasViolations, arrivalLineFloors } = require('../utils/midStayExtrasWindow');

const BASELINE = JSON.stringify({ 'opt:37': 0 });
const before = (typedCount, over = {}) => [{ optionId: 37, quantity: 1, totalPrice: 0, offered: 1, typedCount, ...over }];
const after = (over = {}) => [{ optionId: 37, quantity: 1, totalPrice: 0, offered: 1, ...over }];
const violations = (typedCount, next) => arrivalExtrasViolations(BASELINE, before(typedCount), after(next));

test('rule 27 — the floor of an offered line is its typed count', () => {
  assert.equal(arrivalLineFloors(BASELINE, before(3))['opt:37'].minTypedCount, 3);
});

test('rule 27 — fewer people served on an offered line is refused', () => {
  assert.deepEqual(violations(3, { cardPersons: 2 }), [{ key: 'opt:37', reason: 'reduced' }]);
});

test('rule 27 — fewer nights on an offered line is refused', () => {
  assert.deepEqual(violations(3, { cardNights: 2 }), [{ key: 'opt:37', reason: 'reduced' }]);
});

test('rule 27 — an offered line following the party can be frozen below it only by being refused', () => {
  assert.deepEqual(violations(5, { cardPersons: 4 }), [{ key: 'opt:37', reason: 'reduced' }]);
});

test('rule 27 — the same count, or more, is accepted', () => {
  assert.deepEqual(violations(3, { cardPersons: 3 }), []);
  assert.deepEqual(violations(3, { cardPersons: 4 }), []);
  assert.deepEqual(violations(3, { cardNights: 3 }), []);
});

test('rule 27 — a NULL line following a lowered party is never refused: billed units are not compared', () => {
  assert.deepEqual(violations(5, { cardPersons: null, cardNights: null, billedUnits: 4 }), []);
  assert.deepEqual(violations(5, { billedUnits: 4 }), []);
});

test('rule 27 — a price type with no count has no such floor', () => {
  assert.deepEqual(violations(undefined, { cardPersons: 1 }), []);
});

test('rule 27 with rule 18 — typing the whole number a drifted line reads as still repairs it', () => {
  assert.deepEqual(violations(11.1, { cardPersons: 11 }), []);
  assert.deepEqual(violations(11.1, { cardPersons: 10 }), [{ key: 'opt:37', reason: 'reduced' }]);
});

test('rule 27 — the offered check still comes first: billing the line back is not a reduction', () => {
  assert.deepEqual(violations(3, { cardPersons: 2, offered: 0, totalPrice: 20 }), [{ key: 'opt:37', reason: 'unoffered' }]);
});

// The auditor's reproduction, through the real controller: a started stay, its window open.
test('rule 27 — a save lowering the count of an offered line answers ARRIVAL_EXTRAS_FROZEN and stores nothing', async () => {
  db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Granja', 8)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Test', 'Plancher')").run();
  db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (37, 'Linge de toilette', 8, 'per_person')").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 37)').run();
  const start = todayIso();
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, teens, children, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, kind, checkInTime, checkOutTime, arrivalExtrasBaseline, checkInDone)
      VALUES (1, 1, ?, ?, 5, 0, 0, 0, 'direct', 100, 0, 100, 0, 100, 'reservation', '16:00', '10:00', ?, 1)`)
    .run(start, addIsoDays(start, 2), JSON.stringify({ 'opt:37': 0 })).lastInsertRowid);
  for (const day of [0, 1]) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'fixed', 50)")
      .run(id, addIsoDays(start, day));
  }
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, cardPersons)
              VALUES (?, 37, 1, 8, 3, 'per_person', 0, 1, 3)`).run(id);

  const body = toUpdateBody(model.getByIdWithDetails(id));
  body.options.find((line) => Number(line.optionId) === 37).cardPersons = 2;
  const answer = await controller.performUpdate(String(id), body, {});
  assert.equal(answer.status, 400);
  assert.equal(answer.body.code, 'ARRIVAL_EXTRAS_FROZEN');
  assert.deepEqual(answer.body.lines, [{ key: 'opt:37', reason: 'reduced' }]);
  assert.equal(db.prepare('SELECT cardPersons FROM reservation_options WHERE reservationId = ? AND optionId = 37').get(id).cardPersons, 3);
});
