// specs/outside-booking-sas.md rule 11, specs/pricing-components.md rule 53 (loop t2 UI2-8) — a class's external rate the operator emptied is refused with the field named,
// never ignored: the save used to answer 200 and keep the old rate, and the form reopened with it. A rate not sent keeps the stored one.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

require('../database');
const optionsController = require('../controllers/optionsController');
const sales = require('../models/standaloneSalesModel');

const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

test('UI2-8 — an emptied external rate is refused (EXTERNAL_RATE_EMPTY) and the class keeps its rate; not sent, the save goes through', () => {
  const created = res();
  optionsController.create({ body: { title: 'Bière locale', priceType: 'per_stay', price: 6.5, sellableExternally: true, vatClass: 'drinks', externalVatRate: 20 } }, created);
  assert.equal(created.statusCode, 200);
  const { id } = created.body;
  const emptied = res();
  optionsController.update({ params: { id }, body: { title: 'Bière locale', priceType: 'per_stay', price: 6.5, sellableExternally: true, vatClass: 'drinks', externalVatRate: '' } }, emptied);
  assert.equal(emptied.statusCode, 422);
  assert.deepEqual(emptied.body.details.map((d) => [d.field, d.code]), [['externalVatRate', 'EXTERNAL_RATE_EMPTY']]);
  assert.equal(sales.externalRates().drinks, 20);
  const untouched = res();
  optionsController.update({ params: { id }, body: { title: 'Bière locale', priceType: 'per_stay', price: 7, sellableExternally: true, vatClass: 'drinks' } }, untouched);
  assert.equal(untouched.statusCode, 200);
  assert.equal(sales.externalRates().drinks, 20);
});
