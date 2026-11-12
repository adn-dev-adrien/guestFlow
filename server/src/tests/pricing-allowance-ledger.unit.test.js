// specs/pricing-components.md §3 rules 26, 41 — a line records the free units it consumed (`allowanceUsed`); removing the line gives them
// back to the pool for a future sale, and a standing line is never re-priced by it (D5).
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, controller, createStay, seed,
} = require('./ledgerFixture');
const model = require('../models/reservationsModel');
const { toUpdateBody } = require('../utils/reservationUpdateBody');

seed();
const OPTION = 61;
db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (?, 'Bûche', 'per_stay', 10)").run(OPTION);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(OPTION);
db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, ?, 10, 2)').run(OPTION);

const save = (id, edit) => {
  const body = { ...toUpdateBody(model.getByIdWithDetails(id)), forceOverpayment: true };
  edit(body);
  const result = controller.performUpdate(String(id), body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result;
};
const lineOf = (id) => db.prepare('SELECT quantity, totalPrice, allowanceUsed FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, OPTION);

test('rule 26 — five units sold, two free: the line stores what it consumed', () => {
  const id = createStay();
  save(id, (body) => { body.options = [{ optionId: OPTION, quantity: 5 }]; body.selectedOptions = body.options; });
  const line = lineOf(id);
  assert.equal(line.totalPrice, 30);
  assert.deepEqual(JSON.parse(line.allowanceUsed), { freeUnits: 2, amount: 20 });
});

test('rule 26 — a line that used no free unit stores none', () => {
  const id = createStay();
  db.prepare('UPDATE property_option_prices SET freeUnits = 0 WHERE optionId = ?').run(OPTION);
  try {
    save(id, (body) => { body.options = [{ optionId: OPTION, quantity: 3 }]; body.selectedOptions = body.options; });
    assert.equal(lineOf(id).allowanceUsed, null);
  } finally { db.prepare('UPDATE property_option_prices SET freeUnits = 2 WHERE optionId = ?').run(OPTION); }
});

test('rule 41 — removing the line gives its free units back: the next sale of the article gets them again', () => {
  const id = createStay();
  save(id, (body) => { body.options = [{ optionId: OPTION, quantity: 5 }]; body.selectedOptions = body.options; });
  save(id, (body) => { body.options = []; body.selectedOptions = []; });
  assert.equal(lineOf(id), undefined);
  save(id, (body) => { body.options = [{ optionId: OPTION, quantity: 2 }]; body.selectedOptions = body.options; });
  const again = lineOf(id);
  assert.equal(JSON.parse(again.allowanceUsed).freeUnits, 2);
});
