// specs/qonto-bank-reconciliation.md rules 40–42 — Paris-time days, a covered échéance refuses a second
// credit, the incremental read never skips credits silently.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { day } = require('../reconciliation/dates');
const { up } = require('../reconciliation/schema');
const { createBankTransactionsModel } = require('../reconciliation/bankTransactionsModel');
const { readTransactions } = require('../reconciliation/transactionsReader');
const { USER, addReservation, credit, build, reset, row } = require('./reconciliationFixture');

test.beforeEach(() => { reset(); });

test('rule 40 — a credit settled at 22:30 UTC belongs to the next day in Paris, winter and summer', () => {
  assert.equal(day('2026-10-22T22:30:00.000Z'), '2026-10-23');
  assert.equal(day('2026-01-15T23:30:00.000Z'), '2026-01-16');
  assert.equal(day('2026-10-22T05:00:00.000Z'), '2026-10-22');
  assert.equal(day('2026-10-22'), '2026-10-22', 'a plain date is untouched');
  assert.equal(day('2026-10-22 14:00:00'), '2026-10-22');
  assert.equal(day(null), null);
});

test('rule 41 — a second credit cannot be linked to an échéance another credit already covers', () => {
  const id = addReservation({ balanceAmount: 700, finalPrice: 700 });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 70000), credit('t2', 70000)], { bankAccountId: 'acc-1' });
  const allocations = [{ reservationId: id, ledgerKey: 'balance', amountCents: 70000 }];
  assert.equal(controller.confirm({ transactionId: 't1', allocations, user: USER }).status, 201);
  const second = controller.confirm({ transactionId: 't2', allocations, user: USER });
  assert.equal(second.status, 422);
  assert.equal(second.body.code, 'RECEIPT_ALREADY_COVERED');
  assert.equal(row(id).balancePaid, 1);
});

test('rule 41 — the todo count and the amount received are the server\'s', () => {
  const id = addReservation({ balanceAmount: 700, finalPrice: 700 });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 70000)], { bankAccountId: 'acc-1' });
  controller.confirm({ transactionId: 't1', allocations: [{ reservationId: id, ledgerKey: 'balance', amountCents: 70000 }], user: USER });
  const done = controller.list({ view: 'done' }).body;
  assert.equal(done.items.find((i) => i.reservation.id === id).allocatedCents, 70000);
  const counts = controller.list({ view: 'todo' }).body.counts;
  assert.equal(counts.todo, counts.gaps + counts.proposed + counts.unmatched);
});

test('rule 42 — a read that hits the page cap fails instead of moving lastReadAt past unread credits', async () => {
  const db = new Database(':memory:');
  up(db);
  const model = createBankTransactionsModel(db);
  const store = new Map();
  const settings = { get: (k) => store.get(k) || '', set: (k, v) => store.set(k, v) };
  const client = {
    listBankAccounts: async () => [{ id: 'acc-1', main: true }],
    listTransactions: async ({ page }) => ({ transactions: [], nextPage: page + 1 }),
  };
  const out = await readTransactions({ withQonto: async (fn) => fn(client, 'token'), model, settings, startDate: '2026-10-22' });
  assert.equal(out.ok, false);
  assert.equal(store.get('reconciliationLastReadAt'), undefined);
});
