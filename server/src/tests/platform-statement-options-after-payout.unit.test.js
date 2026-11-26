// specs/platform-host-statement-and-commission-vat.md rule 2 on the statement written AFTER the payout (the usual Gîtes de France case):
// the option lines follow « Options (relevé) » there too, in the correction's own transaction; the one refusal stays.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, inDays, createStay, rowOf, mark } = require('./ledgerFixture');
const statementController = require('../controllers/platformStatementController');

function call(handler, id, body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  handler({ params: { id }, body, user: { role: 'admin' } }, res);
  return res;
}

function receivedStay() {
  const id = createStay({ platform: 'Booking', customPrice: 300, propertyId: 1 });
  const row = rowOf(id);
  const res = mark(id, { balancePaid: true, balancePaidDate: inDays(-60), expectedAmountCents: Math.round(row.balanceAmount * 100) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(inDays(-40), inDays(-37), id);
  return id;
}

test('a statement typed after the payout adds the free line « Options <plateforme> » for the options it bills, and prices the stay on it', () => {
  const id = receivedStay();
  const before = rowOf(id);
  const res = call(statementController.update, id, { platformGrossAmount: before.balanceAmount + 80, platformOptionsAmount: 80, platformCommissionAmount: 80 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(res.body.lines.some((l) => /Options Booking/.test(l.label)), 'the adjustment is told');
  const line = db.prepare('SELECT description, amount, offered FROM reservation_custom_options WHERE reservationId = ?').get(id);
  assert.deepEqual([line.description, line.amount, Number(line.offered || 0)], ['Options Booking', 80, 0]);
  assert.equal(rowOf(id).platformOptionsAmount, 80);
});

test('the preview answers the same adjustment and writes nothing', () => {
  const id = receivedStay();
  const before = rowOf(id);
  const res = call(statementController.preview, id, { platformGrossAmount: before.balanceAmount + 80, platformOptionsAmount: 80 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(res.body.lines.some((l) => /Options Booking/.test(l.label)));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options WHERE reservationId = ?').get(id).n, 0);
});

test('the one refusal: options the fiche bills and no line can settle, answered on the field', () => {
  const id = receivedStay();
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, offered, inComplement) VALUES (?, 'Bois', 40, 0, 0)").run(id);
  const res = call(statementController.preview, id, { platformGrossAmount: 100, platformOptionsAmount: 10 });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.field, 'platformOptionsAmount');
  assert.match(res.body.error, /retirer une option/);
});
