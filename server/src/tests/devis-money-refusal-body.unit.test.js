// specs/reservations-backend-mvc.md rule 19 (reading of 2026-11-05, audit R23-7) — a devis's money refusal answers what
// the stay's answers: French text and its code, never the raw code as the error.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildController } = require('../controllers/devisController');

function fakeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

const model = { findById: () => ({ id: 1 }), create: () => assert.fail('nothing created'), update: () => assert.fail('nothing updated') };
const controller = buildController(model, { emitPluginEvent: () => {} });

test('rule 19 — POST /devis, customPrice 1e308: French text and the code', () => {
  const res = fakeRes();
  controller.create({ body: { customPrice: 1e308 } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Montant invalide : saisir un nombre.', code: 'NOT_A_NUMBER' });
});

test('rule 19 — PUT /devis/:id, customPrice 1e308: French text and the code', () => {
  const res = fakeRes();
  controller.update({ params: { id: '1' }, body: { customPrice: 1e308 } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Montant invalide : saisir un nombre.', code: 'NOT_A_NUMBER' });
});

test('rule 19 — a negative amount on a devis says so', () => {
  const res = fakeRes();
  controller.create({ body: { customPrice: -5 } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Un montant ne peut pas être négatif.', code: 'NEGATIVE_AMOUNT' });
});
