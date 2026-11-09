// specs/mixed-method-payments.md rules 22, 43 (audit R34-EXT-1) — a bank credit matched on a split payment's receipt
// (`settlement-<id>`) holds that payment: undoing it is refused, like modifying it. And a split recorded over a target
// whose plain receipt (`balance`, `group`, `installment-N`) already holds a bank line is refused: the line would be left
// pointing at a receipt no longer expected. In both cases « Défaire » the reconciliation first, then the payment.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, USER, dayAt, addReservation, credit, build, reset } = require('./reconciliationFixture');
const controller = require('../../../controllers/reservationsController');
const settlementsController = require('../../../controllers/paymentSettlementsController');
const settlementsModel = require('../../../models/paymentSettlementsModel');

const REFUSAL = 'Déjà rapproché avec la banque : défaites le rapprochement d\'abord.';
const call = (handler, params, body) => {
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  handler({ params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), body, user: USER }, res);
  return res;
};
const lines = () => db.prepare('SELECT transactionId, ledgerKey FROM bank_reconciliation_lines ORDER BY id').all();
const transfer = (amountCents) => ({ method: 'transfer', amountCents, internal: false });
const cashIn = (amountCents) => ({ method: 'cash', amountCents, internal: true });

test.beforeEach(() => {
  reset();
  db.prepare('DELETE FROM payment_settlements').run();
});

function stay() {
  return addReservation({ startDate: dayAt(-21), endDate: dayAt(-19), finalPrice: 700, depositAmount: 0, balanceAmount: 700, balanceDueDate: dayAt(-30) });
}
const paySplit = (id) => call(controller.updatePayment, { id }, {
  balancePaid: true, balancePaidDate: dayAt(-12), expectedAmountCents: 70000, tenders: [transfer(50000), cashIn(20000)],
});

function confirm(reco, id, ledgerKey) {
  const out = reco.confirm({ transactionId: 't1', allocations: [{ reservationId: id, ledgerKey, amountCents: 50000 }], user: USER });
  assert.ok(out.status < 300, JSON.stringify(out.body));
}

test('rule 43 — a split solde whose transfer is matched: « Annuler l\'encaissement » refused, nothing written', () => {
  const id = stay();
  assert.equal(paySplit(id).statusCode, 200);
  const [s] = settlementsModel.listFor(id);
  const { controller: reco, transactions } = build();
  transactions.upsertMany([credit('t1', 50000)], { bankAccountId: 'acc-1' });
  confirm(reco, id, `settlement-${s.id}`);

  const undo = call(controller.updatePayment, { id }, { balancePaid: false });
  assert.equal(undo.statusCode, 409, JSON.stringify(undo.body));
  assert.equal(undo.body.error, REFUSAL);
  assert.equal(undo.body.code, 'SETTLEMENT_RECONCILED');
  assert.equal(db.prepare('SELECT balancePaid FROM reservations WHERE id = ?').get(id).balancePaid, 1);
  assert.equal(settlementsModel.listFor(id).length, 1);
  assert.deepEqual(lines(), [{ transactionId: 't1', ledgerKey: `settlement-${s.id}` }]);

  // Once the reconciliation is undone, the payment can be taken back.
  assert.ok(reco.undo({ transactionId: 't1', user: USER }).status < 300);
  assert.equal(call(controller.updatePayment, { id }, { balancePaid: false }).statusCode, 200);
  assert.equal(settlementsModel.listFor(id).length, 0);
});

// A solde and a complement still due: what « Encaisser en une fois » gathers in one payment.
const arrivalStay = () => addReservation({
  startDate: dayAt(-21), endDate: dayAt(-19), finalPrice: 700, depositAmount: 0, balanceAmount: 650, complementAmount: 50, balanceDueDate: dayAt(-30),
});

test('rule 43 — a split single arrival payment matched: its undo refused', () => {
  const id = arrivalStay();
  const split = call(controller.settleArrivalPayment, { id }, {
    mode: 'split', date: dayAt(0), expectedAmountCents: 70000, tenders: [transfer(50000), cashIn(20000)],
  });
  assert.equal(split.statusCode, 200, JSON.stringify(split.body));
  const [s] = settlementsModel.listFor(id);
  const { controller: reco, transactions } = build();
  transactions.upsertMany([credit('t1', 50000)], { bankAccountId: 'acc-1' });
  confirm(reco, id, `settlement-${s.id}`);
  const undo = call(controller.settleArrivalPayment, { id }, { mode: 'undo' });
  assert.equal(undo.statusCode, 409, JSON.stringify(undo.body));
  assert.equal(undo.body.error, REFUSAL);
  assert.equal(settlementsModel.listFor(id).length, 1);
});

test('rule 43 — a transfer matched on the plain solde, then the solde recorded as a split: refused', () => {
  const id = stay();
  const { controller: reco, transactions } = build();
  transactions.upsertMany([credit('t1', 50000)], { bankAccountId: 'acc-1' });
  confirm(reco, id, 'balance');
  const res = paySplit(id);
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, REFUSAL);
  assert.equal(db.prepare('SELECT balancePaid FROM reservations WHERE id = ?').get(id).balancePaid, 0);
  assert.equal(settlementsModel.listFor(id).length, 0);
  assert.deepEqual(lines(), [{ transactionId: 't1', ledgerKey: 'balance' }]);
});

test('rule 43 — a transfer matched on the plain solde, then a split single arrival payment over it: refused', () => {
  const id = arrivalStay();
  const { controller: reco, transactions } = build();
  transactions.upsertMany([credit('t1', 50000)], { bankAccountId: 'acc-1' });
  confirm(reco, id, 'balance');
  const res = call(controller.settleArrivalPayment, { id }, {
    mode: 'split', date: dayAt(0), expectedAmountCents: 70000, tenders: [transfer(50000), cashIn(20000)],
  });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, REFUSAL);
  assert.equal(settlementsModel.listFor(id).length, 0);
});

test('rule 22 — the matched settlement is still refused a correction (unchanged)', () => {
  const id = stay();
  assert.equal(paySplit(id).statusCode, 200);
  const [s] = settlementsModel.listFor(id);
  const { controller: reco, transactions } = build();
  transactions.upsertMany([credit('t1', 50000)], { bankAccountId: 'acc-1' });
  confirm(reco, id, `settlement-${s.id}`);
  const res = call(settlementsController.modify, { id, settlementId: s.id }, { date: dayAt(-12), tenders: [transfer(40000), cashIn(30000)] });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, REFUSAL);
});
