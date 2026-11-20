// specs/pricing-components.md §3 rule 31 (PR C, C23) — the fiche payload embeds the saleDetail read model: opening the reservation needs no
// second request, and the embedded payload is the one `GET …/sale-detail` serves.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');

const { db, createStay, seed } = require('./ledgerFixture');
const model = require('../models/reservationsModel');
const controller = require('../controllers/reservationsController');
const extraSale = require('../utils/extraSale');

const fetchFiche = (id, user = { role: 'admin' }) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.getById({ params: { id }, user }, res);
  return res;
};

test('rule 31 — the fiche payload carries the saleDetail the sale-detail endpoint serves', () => {
  seed();
  const id = createStay();
  model.commitArrivalSas(id, { complementItems: [{ label: 'Taie d’oreiller', amount: 6, qty: 2 }] });
  const { body } = fetchFiche(id);
  assert.deepEqual(body.saleDetail, extraSale.saleDetailOf(id));
  assert.deepEqual(body.saleDetail.lines.find((l) => l.label === 'Taie d’oreiller').source, 'sas');
});

test('rule 31 — the reception view, finance-stripped, carries no saleDetail', () => {
  seed();
  const id = createStay();
  const { body } = fetchFiche(id, { role: 'reception' });
  assert.equal(body.saleDetail, undefined);
});
