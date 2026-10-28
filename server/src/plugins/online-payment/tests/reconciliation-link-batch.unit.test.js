// specs/reconciliation-assisted-matching.md rule 8 — « Rattacher » sends every pair in one call: all pairs
// and their fiche writes succeed together or none is stored. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, USER, addReservation, credit, build, reset, row } = require('./reconciliationFixture');
const { applyPaymentMark } = require('../../../utils/reservationPaymentMark');

test.beforeEach(() => { reset(); });

const at = (day) => `${day}T09:00:00.000Z`;
const stay = (over = {}) => addReservation({
  depositAmount: 300, depositDueDate: '2026-10-14', balanceAmount: 700, finalPrice: 1000, balanceDueDate: '2026-11-01', ...over,
});
const pair = (transactionId, reservationId, ledgerKey, amountCents) => ({ transactionId, reservationId, ledgerKey, amountCents });
const lines = () => db.prepare('SELECT * FROM bank_reconciliation_lines').all();

test('rule 8 — two credits cover the acompte: the fiche is marked received at the latest credit date, in one call', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([credit('a', 15000, { settledAt: at('2026-10-10') }), credit('b', 15000, { settledAt: at('2026-10-12') })], { bankAccountId: 'acc-1' });
  const answer = controller.linkBatch({ pairs: [pair('a', id, 'deposit', 15000), pair('b', id, 'deposit', 15000)], user: USER });
  assert.equal(answer.status, 201);
  assert.equal(answer.body.marked.length, 1);
  assert.equal(row(id).depositPaid, 1);
  assert.equal(row(id).depositPaidDate, '2026-10-12');
  assert.equal(lines().length, 2);
});

test('rule 8 — specs/qonto-bank-reconciliation.md rule 37: a partial cover stores the lines and marks nothing', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([credit('a', 15000, { settledAt: at('2026-10-10') })], { bankAccountId: 'acc-1' });
  const answer = controller.linkBatch({ pairs: [pair('a', id, 'deposit', 15000)], user: USER });
  assert.equal(answer.status, 201);
  assert.deepEqual(answer.body.notWritten.map((n) => n.reason), ['partial']);
  assert.equal(row(id).depositPaid, 0);
  assert.equal(lines().length, 1);
});

test('rule 8 — one refused pair stores nothing for any pair', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([credit('a', 30000, { settledAt: at('2026-10-10') }), credit('b', 10000, { settledAt: at('2026-10-12') })], { bankAccountId: 'acc-1' });
  const answer = controller.linkBatch({ pairs: [pair('a', id, 'deposit', 30000), pair('b', id, 'balance', 20000)], user: USER });
  assert.equal(answer.status, 422);
  assert.equal(answer.body.code, 'ALLOCATION_EXCEEDS_TRANSACTION');
  assert.equal(lines().length, 0);
  assert.equal(row(id).depositPaid, 0);
});

test('rule 8 — a pair above what the receipt still expects is refused (ALLOCATION_EXCEEDS_RECEIPT)', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([credit('a', 90000, { settledAt: at('2026-10-10') })], { bankAccountId: 'acc-1' });
  const answer = controller.linkBatch({ pairs: [pair('a', id, 'deposit', 40000)], user: USER });
  assert.equal(answer.status, 422);
  assert.equal(answer.body.code, 'ALLOCATION_EXCEEDS_RECEIPT');
  assert.equal(lines().length, 0);
});

test('rule 8 — the core\'s refusal passes through and cancels every line, including those of other fiches', () => {
  const first = stay();
  const second = stay({ clientId: 2 });
  const refusing = ({ reservationId, body, user }) => (reservationId === second
    ? { status: 422, body: { error: 'Marquage refusé par la fiche.', code: 'CORE_REFUSAL' } }
    : applyPaymentMark({ reservationId, body, user }));
  const { controller, transactions } = build({ mark: refusing });
  transactions.upsertMany([credit('a', 30000, { settledAt: at('2026-10-10') }), credit('b', 30000, { settledAt: at('2026-10-11') })], { bankAccountId: 'acc-1' });
  const answer = controller.linkBatch({ pairs: [pair('a', first, 'deposit', 30000), pair('b', second, 'deposit', 30000)], user: USER });
  assert.equal(answer.status, 422);
  assert.equal(answer.body.code, 'CORE_REFUSAL');
  assert.equal(lines().length, 0, 'the first fiche\'s line is rolled back with the second\'s refusal');
  assert.equal(row(first).depositPaid, 0);
});

test('rule 8 — at most 10 credits per call; an empty call is refused', () => {
  const id = stay();
  const { controller } = build();
  const many = Array.from({ length: 11 }, (_, i) => pair(`t${i}`, id, 'deposit', 100));
  assert.equal(controller.linkBatch({ pairs: many, user: USER }).body.code, 'INVALID_ALLOCATION');
  assert.equal(controller.linkBatch({ pairs: [], user: USER }).status, 422);
});

test('rule 8 — specs/qonto-bank-reconciliation.md rule 38: « Défaire » on each credit takes the fiche back', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([credit('a', 15000, { settledAt: at('2026-10-10') }), credit('b', 15000, { settledAt: at('2026-10-12') })], { bankAccountId: 'acc-1' });
  controller.linkBatch({ pairs: [pair('a', id, 'deposit', 15000), pair('b', id, 'deposit', 15000)], user: USER });
  controller.undo({ transactionId: 'a', user: USER });
  assert.equal(row(id).depositPaid, 0);
  assert.equal(lines().length, 1);
});
