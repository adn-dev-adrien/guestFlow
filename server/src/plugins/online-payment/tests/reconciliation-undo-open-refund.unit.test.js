// specs/reservation-refunds.md rule 52 (audit R23 N7, 2026-11-05), specs/qonto-bank-reconciliation.md rule 38 — « Défaire » takes a
// confirmed receipt back like an un-tick: refused while a book refund needs that money. Reached on an installment through the
// plugin's writer, on a bucket through the core mark. No payment link in these scenarios.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, USER, addReservation, credit, build, reset, row, dayAt } = require('./reconciliationFixture');
const sdk = require('../../sdk');
const refundsModel = require('../../../models/refundsModel');

test.beforeEach(() => { reset(); db.prepare('DELETE FROM reservation_installments WHERE reservationId >= 100').run(); db.prepare('DELETE FROM reservation_refunds').run(); });

const refundOf = (id, amountTtc) => refundsModel.create(id, {
  refundDate: dayAt(0), method: 'transfer', reason: '', totalTtc: amountTtc,
  lines: [{ lineKey: 'accommodation', label: 'Hébergement', bucket: 'accommodation', quantity: null, unitPrice: null, amountTtc, vatRate: 10 }],
});

function confirmedInstallment() {
  const id = addReservation({ finalPrice: 600, balanceAmount: 0, installmentsTarget: 60000 });
  const model = sdk.coreModule('installmentsModel').buildModel(db);
  model.replacePlan(id, [{ number: 1, dueDate: dayAt(-11), amountCents: 30000 }, { number: 2, dueDate: dayAt(9), amountCents: 30000 }]);
  const { controller, transactions } = build();
  transactions.upsertMany([credit('i1', 30000)], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'i1', allocations: [{ reservationId: id, ledgerKey: 'installment-1', amountCents: 30000 }], user: USER });
  assert.equal(Number(row(id).installmentsPaidAmount), 300);
  return { id, controller, model };
}

test('an installment with a refund open: 409 naming it, the payment and the link kept; deleted, « Défaire » passes', () => {
  const { id, controller, model } = confirmedInstallment();
  const refundId = refundOf(id, 100);
  const refused = controller.undo({ transactionId: 'i1', user: USER });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'REFUND_BLOCKS_UNTICK');
  assert.match(refused.body.error, /^Remboursement du .* \(100,00.€\) à supprimer d’abord\.$/);
  assert.equal(Number(model.listFor(id)[0].paid), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_reconciliation_lines').get().n, 1);

  refundsModel.remove(id, refundId);
  const undone = controller.undo({ transactionId: 'i1', user: USER });
  assert.equal(undone.status, 200);
  assert.equal(undone.body.restored.length, 1);
  assert.equal(Number(row(id).installmentsPaidAmount || 0), 0);
});

test('a refund the rest of the plan covers lets « Défaire » through', () => {
  const { id, controller, model } = confirmedInstallment();
  const installments = model.listFor(id);
  model.markPaid(installments[1].id, { paidDate: dayAt(-1), method: 'card' });
  refundOf(id, 100);
  assert.equal(controller.undo({ transactionId: 'i1', user: USER }).status, 200);
  assert.equal(Number(row(id).installmentsPaidAmount), 300);
});

test('a bucket with a refund open: the same 409, the mark and the link kept', () => {
  const id = addReservation({ platform: 'direct', finalPrice: 700, balanceAmount: 700, balanceDueDate: dayAt(-13) });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('b1', 70000)], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'b1', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 70000 }], user: USER });
  assert.equal(row(id).balancePaid, 1);
  refundOf(id, 200);
  const refused = controller.undo({ transactionId: 'b1', user: USER });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'REFUND_BLOCKS_UNTICK');
  assert.equal(row(id).balancePaid, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_reconciliation_lines').get().n, 1);
});

test('a fiche edited since is left alone as before: no refusal over a mark « Défaire » would not touch', () => {
  const id = addReservation({ platform: 'direct', finalPrice: 700, balanceAmount: 700, balanceDueDate: dayAt(-13) });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('b2', 70000)], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 'b2', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 70000 }], user: USER });
  db.prepare(`UPDATE reservations SET balancePaidDate = '${dayAt(-10)}' WHERE id = ?`).run(id);
  refundOf(id, 200);
  const answer = controller.undo({ transactionId: 'b2', user: USER });
  assert.equal(answer.status, 200);
  assert.equal(answer.body.untouched.length, 1);
});
