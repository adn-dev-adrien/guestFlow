// specs/qonto-bank-reconciliation.md rule 51 (audit R42-EXT-L1, 2026-11-10) — « Écarter » on a stay id not yet given
// stored a pair that later hid that stay's proposal; « Hors réservation » on a credit never read stored a row too.
// Both name nothing: 404, nothing stored. The real pair of a shown proposal is still discarded.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, build, reset, addReservation, credit, USER } = require('./reconciliationFixture');

test.beforeEach(() => { reset(); });
const discards = () => db.prepare('SELECT COUNT(*) AS n FROM bank_reconciliation_discards').get().n;
const outside = () => db.prepare('SELECT COUNT(*) AS n FROM bank_transactions_outside').get().n;
const unusedId = () => Number(db.prepare('SELECT COALESCE(MAX(id), 0) + 1000 AS n FROM reservations').get().n);

test('rule 51 — a discard naming a stay that does not exist is 404 UNKNOWN_RESERVATION, nothing stored, the later stay keeps its proposal', () => {
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 70000, { counterpartyName: 'Dupont' })], { bankAccountId: 'acc-1' });
  const future = unusedId();
  const answer = controller.discard({ transactionId: 't1', reservationId: future, ledgerKey: 'balance' });
  assert.equal(answer.status, 404, JSON.stringify(answer.body));
  assert.equal(answer.body.code, 'UNKNOWN_RESERVATION');
  assert.equal(discards(), 0);
  addReservation({ id: future, balanceAmount: 700, finalPrice: 700 });
  const item = controller.compute().items.find((i) => i.reservation.id === future);
  assert.ok(item && item.proposal, 'the stay created later is proposed');
});

test('rule 51 — a discard naming a credit never read is 404 UNKNOWN_TRANSACTION, nothing stored', () => {
  const { controller } = build();
  const id = addReservation({ balanceAmount: 700, finalPrice: 700 });
  const answer = controller.discard({ transactionId: 'never-read', reservationId: id, ledgerKey: 'balance' });
  assert.equal(answer.status, 404, JSON.stringify(answer.body));
  assert.equal(answer.body.code, 'UNKNOWN_TRANSACTION');
  assert.equal(discards(), 0);
});

test('rule 51 — « Hors réservation » on a credit never read is 404, nothing stored; a read credit is still marked and unmarked', () => {
  const { controller, transactions } = build();
  const refused = controller.setOutside({ transactionId: 'never-read', outside: true, user: USER });
  assert.equal(refused.status, 404, JSON.stringify(refused.body));
  assert.equal(refused.body.code, 'UNKNOWN_TRANSACTION');
  assert.equal(outside(), 0);
  transactions.upsertMany([credit('t2', 5000)], { bankAccountId: 'acc-1' });
  assert.equal(controller.setOutside({ transactionId: 't2', outside: true, user: USER }).status, 200);
  assert.equal(outside(), 1);
  assert.equal(controller.setOutside({ transactionId: 't2', outside: false, user: USER }).status, 200);
  assert.equal(outside(), 0);
});

test('rule 51 — the shown proposal of a real stay and a real credit is still discarded', () => {
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t3', 70000, { counterpartyName: 'Dupont' })], { bankAccountId: 'acc-1' });
  const id = addReservation({ balanceAmount: 700, finalPrice: 700 });
  const answer = controller.discard({ transactionId: 't3', reservationId: id, ledgerKey: 'balance' });
  assert.equal(answer.status, 201, JSON.stringify(answer.body));
  assert.ok(discards() >= 1);
});
