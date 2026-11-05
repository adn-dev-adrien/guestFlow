// specs/non-card-option-served-persons.md rule 37 (audit R22-6 of the reservations slice, 2026-11-05) — an offered
// planning-card line has a floor too: the cardPersons it stored. A NULL count follows the party and is never compared.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, createStay, seed,
} = require('./ledgerFixture');
const model = require('../models/reservationsModel');
const { arrivalLineFloors, arrivalExtrasViolations } = require('../utils/midStayExtrasWindow');
const { extraLineKey } = require('../utils/midStayExtras');

seed();
db.prepare("INSERT INTO options (id, title, priceType, price, showsPlanningCard) VALUES (70, 'Dîner', 'per_person', 25, 1)").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 70)').run();
const KEY = extraLineKey({ optionId: 70 });

function offeredCardLine(cardPersons) {
  const id = createStay({ options: [{ optionId: 70, quantity: 1, cardPersons }], selectedOptions: [{ optionId: 70, quantity: 1, cardPersons }], offeredOptionIds: [70] });
  db.prepare('UPDATE reservation_options SET offered = 1, totalPrice = 0, cardPersons = ? WHERE reservationId = ? AND optionId = 70').run(cardPersons, id);
  return { id, lines: model.readExtraLinesWithQuantity(id) };
}
const baseline = JSON.stringify({ [KEY]: 0 });
const after = (cardPersons) => [{ optionId: 70, quantity: 1, offered: 1, totalPrice: 0, cardPersons }];

test('an offered card line: its stored cardPersons is the floor, lower is reduced', () => {
  const { lines } = offeredCardLine(3);
  assert.equal(arrivalLineFloors(baseline, lines)[KEY].minTypedCount, 3);
  assert.deepEqual(arrivalExtrasViolations(baseline, lines, after(2)), [{ key: KEY, reason: 'reduced' }]);
  assert.deepEqual(arrivalExtrasViolations(baseline, lines, after(3)), []);
  assert.deepEqual(arrivalExtrasViolations(baseline, lines, after(4)), []);
});

test('NULL is never compared, on either side', () => {
  const { lines } = offeredCardLine(null);
  assert.equal(arrivalLineFloors(baseline, lines)[KEY].minTypedCount, undefined);
  assert.deepEqual(arrivalExtrasViolations(baseline, lines, after(1)), []);
  const typed = offeredCardLine(3);
  assert.deepEqual(arrivalExtrasViolations(baseline, typed.lines, after(null)), []);
});

test('a card line that is paid keeps its amount floor: no typed count enters it', () => {
  const id = createStay({ options: [{ optionId: 70, quantity: 1, cardPersons: 3 }], selectedOptions: [{ optionId: 70, quantity: 1, cardPersons: 3 }] });
  db.prepare('UPDATE reservation_options SET cardPersons = 3 WHERE reservationId = ? AND optionId = 70').run(id);
  const lines = model.readExtraLinesWithQuantity(id);
  assert.equal(lines.find((line) => line.optionId === 70).typedCount ?? null, null);
});
