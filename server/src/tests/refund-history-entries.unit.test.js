// specs/pricing-components.md §3 rule 72 (S12) — a refund made and a refund deleted are entries of the stay's history, with the
// amount and the means, never a name.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, fiche, pay, S, NO_ACOMPTE, register, refund,
} = require('./moneyLedgerFixture');
const refundsController = require('../controllers/refundsController');

const entries = (id, type) => db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ? AND eventType = ? ORDER BY id').all(id, type)
  .map((r) => JSON.parse(r.changedFields)[0]);

test('rule 72 (S12) — a refund writes a `refund` entry, its deletion a `refundDeleted` entry', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  pay(id, S);
  const line = register(id).refundableLines.find((l) => l.refundableTtc > 3);
  const made = refund(id, [{ key: line.key, amountTtc: 3 }], 'cash');
  assert.equal(made.statusCode, 201);
  const [entry] = entries(id, 'refund');
  assert.equal(entry.label, 'Remboursement');
  assert.match(entry.to, /^3,00\s€ remboursés \(espèces\)$/);

  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  refundsController.remove({ params: { id, refundId: made.body.refund.id } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [deleted] = entries(id, 'refundDeleted');
  assert.equal(deleted.label, 'Remboursement supprimé');
  assert.match(deleted.from, /^3,00\s€ remboursés \(espèces\)$/);
});

test('rule 72 (S12) — a refused refund writes no entry', () => {
  const { id } = fiche(NO_ACOMPTE, 'direct');
  const line = register(id).refundableLines[0];
  const before = entries(id, 'refund').length;
  const res = refund(id, [{ key: line.key, amountTtc: 999999 }]);
  assert.notEqual(res.statusCode, 201);
  assert.equal(entries(id, 'refund').length, before);
});
