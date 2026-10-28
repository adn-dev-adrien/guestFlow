// specs/reconciliation-assisted-matching.md rules 15–16 — a guest who pays in several transfers is proposed
// as one proposal over several credits; equal installments follow their plan's order. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, USER, addReservation, credit, build, reset, row } = require('./reconciliationFixture');
const sdk = require('../../sdk');

test.beforeEach(() => { reset(); db.prepare('DELETE FROM reservation_installments WHERE reservationId >= 100').run(); });

const at = (day) => `${day}T09:00:00.000Z`;
const stay = (over = {}) => addReservation({
  depositAmount: 300, depositDueDate: '2026-10-14', balanceAmount: 700, finalPrice: 1000, balanceDueDate: '2026-11-01', ...over,
});
const line = (controller, id, key) => ['todo', 'waiting'].flatMap((view) => controller.list({ view }).body.items).find((i) => i.reservation.id === id && i.ledgerKey === key);

test('rule 15 — two named transfers that make the acompte are one proposal over two credits', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([
    credit('a', 15000, { settledAt: at('2026-10-10'), counterpartyName: 'M. DUPONT' }),
    credit('b', 15000, { settledAt: at('2026-10-12'), counterpartyName: 'DUPONT JEAN' }),
  ], { bankAccountId: 'acc-1' });
  const item = line(controller, id, 'deposit');
  assert.equal(item.state, 'proposed');
  assert.equal(item.proposal.confidence, 'probable');
  assert.equal(item.proposal.reason, '2 virements du client');
  assert.deepEqual(item.proposal.parts.map((p) => [p.transactionId, p.amountCents]), [['a', 15000], ['b', 15000]]);
  assert.equal(item.proposal.amountCents, 30000);
});

test('rule 15 — confirming it stores both credits and marks the acompte received at the later date', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([
    credit('a', 15000, { settledAt: at('2026-10-10'), counterpartyName: 'M. DUPONT' }),
    credit('b', 15000, { settledAt: at('2026-10-12'), counterpartyName: 'DUPONT JEAN' }),
  ], { bankAccountId: 'acc-1' });
  const { proposalIds, amounts } = controller.list({ view: 'todo', filter: 'proposed' }).body.bulk;
  const answer = controller.confirmAll({ proposalIds, amounts, user: USER }).body;
  assert.equal(answer.confirmed.length, 1);
  assert.equal(row(id).depositPaid, 1);
  assert.equal(row(id).depositPaidDate, '2026-10-12');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_reconciliation_lines').get().n, 2);
});

test('rule 15 — three transfers that make the whole stay are proposed, allocated oldest onto the earliest due', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([
    credit('a', 25000, { settledAt: at('2026-10-10'), counterpartyName: 'DUPONT' }),
    credit('b', 25000, { settledAt: at('2026-10-12'), counterpartyName: 'DUPONT' }),
    credit('c', 50000, { settledAt: at('2026-10-20'), counterpartyName: 'DUPONT' }),
  ], { bankAccountId: 'acc-1' });
  const item = line(controller, id, 'deposit');
  assert.equal(item.proposal.reason, '3 virements du client');
  assert.deepEqual(item.proposal.allocations.map((a) => [a.ledgerKey, a.amountCents]), [['deposit', 30000], ['balance', 70000]]);
  assert.equal(item.proposal.alsoCovers.length, 1, 'the same proposal covers the solde');
});

test('rule 15 — the client\'s name is required on every credit, and 30 days from the échéance at most', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([
    credit('a', 15000, { settledAt: at('2026-10-10'), counterpartyName: 'M. DUPONT' }),
    credit('b', 15000, { settledAt: at('2026-10-12'), counterpartyName: 'ACME' }),
  ], { bankAccountId: 'acc-1' });
  assert.equal(line(controller, id, 'deposit').proposal.parts, null, 'no split without the name on both');

  reset();
  const far = stay();
  const built = build();
  built.transactions.upsertMany([
    credit('a', 15000, { settledAt: at('2026-10-10'), counterpartyName: 'M. DUPONT' }),
    credit('b', 15000, { settledAt: at('2026-12-30'), counterpartyName: 'DUPONT' }),
  ], { bankAccountId: 'acc-1' });
  const item = line(built.controller, far, 'deposit');
  assert.ok(!item.proposal || !item.proposal.parts, 'a transfer 77 days after the échéance is not part of it');
});

test('rule 15 — not proposed when one credit already matches exactly', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([
    credit('exact', 30000, { settledAt: at('2026-10-10'), counterpartyName: 'M. DUPONT' }),
    credit('x', 10000, { settledAt: at('2026-10-11'), counterpartyName: 'DUPONT' }),
    credit('y', 20000, { settledAt: at('2026-10-12'), counterpartyName: 'DUPONT' }),
  ], { bankAccountId: 'acc-1' });
  const item = line(controller, id, 'deposit');
  assert.equal(item.proposal.bank.transactionId, 'exact');
  assert.equal(item.proposal.parts, null);
});

test('rule 16 — among equal installments the earliest due is proposed and the others never appear as alternatives', () => {
  const id = addReservation({ finalPrice: 1000, depositAmount: 0, balanceAmount: 0 });
  sdk.coreModule('installmentsModel').buildModel(db).replacePlan(id, [
    { number: 1, dueDate: '2026-10-01', amountCents: 33400 }, { number: 2, dueDate: '2026-10-20', amountCents: 33400 }, { number: 3, dueDate: '2026-11-05', amountCents: 33200 },
  ], 100000);
  const { controller, transactions } = build();
  transactions.upsertMany([credit('late', 33400, { settledAt: at('2026-10-22'), counterpartyName: 'M. DUPONT' })], { bankAccountId: 'acc-1' });
  const first = line(controller, id, 'installment-1');
  const second = line(controller, id, 'installment-2');
  assert.equal(first.state, 'proposed');
  assert.equal(first.proposal.bank.transactionId, 'late');
  assert.equal(first.alternatives.length, 0);
  assert.equal(second.proposal, null);
  assert.equal(second.alternatives.length, 0, 'no competing alternative on the second installment');
});
