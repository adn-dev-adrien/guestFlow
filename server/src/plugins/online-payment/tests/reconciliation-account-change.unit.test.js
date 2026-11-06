// specs/qonto-bank-reconciliation.md rule 49 (audit R24 E24-1) — a bank account with no credit stored yet gets its first
// read (rule 5), whatever was read on another account before; an account with credits stays incremental.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { up } = require('../reconciliation/schema');
const { createBankTransactionsModel } = require('../reconciliation/bankTransactionsModel');
const { readTransactions, firstReadFrom } = require('../reconciliation/transactionsReader');
const { todayIso } = require('../../../utils/localDate');
const { addDaysToIsoDate } = require('../../../utils/devisHelpers');

const TODAY = todayIso();
const START = addDaysToIsoDate(TODAY, -60);
const instant = (days, hour = 10) => new Date(Date.now() + days * 864e5 + (hour - 12) * 3600e3).toISOString();

function fixture() {
  const db = new Database(':memory:');
  up(db);
  const model = createBankTransactionsModel(db);
  const store = new Map();
  const settings = { get: (k) => store.get(k) || '', set: (k, v) => store.set(k, v) };
  const creditsOf = {
    A: [{ id: 'a1', settledAt: instant(-10) }],
    // b-old is inside rule 5's first window (13 months before START), long before the read on A.
    B: [{ id: 'b-old', settledAt: instant(-200) }, { id: 'b-new', settledAt: instant(-1) }],
  };
  const calls = [];
  const client = {
    listBankAccounts: async () => [{ id: 'A', main: true }, { id: 'B' }],
    listTransactions: async (q) => {
      calls.push(q);
      const list = (creditsOf[q.bankAccountId] || [])
        .map((t) => ({ ...t, updatedAt: t.settledAt }))
        .filter((t) => (!q.updatedFrom || t.updatedAt >= q.updatedFrom) && (!q.settledFrom || t.settledAt >= q.settledFrom));
      return {
        transactions: list.map((t) => ({ ...t, amountCents: 1000, currency: 'EUR', side: 'credit', status: 'completed', emittedAt: t.settledAt })),
        nextPage: null,
      };
    },
  };
  const read = (now) => readTransactions({ withQonto: async (fn) => fn(client, 'token'), model, settings, startDate: START, now: () => now });
  return { model, store, calls, read };
}

test('rule 49 — the account picked after a first read gets its own first read, history included', async () => {
  const f = fixture();
  await f.read(new Date(instant(0, 8)));
  assert.deepEqual(f.model.listForAccount('A').map((t) => t.id), ['a1']);

  f.store.set('reconciliationBankAccountId', 'B');
  await f.read(new Date(instant(0, 9)));
  const last = f.calls.at(-1);
  assert.equal(last.bankAccountId, 'B');
  assert.equal(last.settledFrom, firstReadFrom(START));
  assert.equal(last.updatedFrom, undefined);
  assert.deepEqual(f.model.listForAccount('B').map((t) => t.id).sort(), ['b-new', 'b-old']);
});

test('rule 49 — once the account has credits, its reads are incremental again', async () => {
  const f = fixture();
  await f.read(new Date(instant(0, 8)));
  f.store.set('reconciliationBankAccountId', 'B');
  await f.read(new Date(instant(0, 9)));
  await f.read(new Date(instant(0, 10)));
  assert.ok(f.calls.at(-1).updatedFrom, 'B is read incrementally from its second read');
  assert.equal(f.calls.at(-1).settledFrom, undefined);
});

test('rule 49 — residue: back on an account with credits, the read stays incremental (the time spent elsewhere is not re-read)', async () => {
  const f = fixture();
  await f.read(new Date(instant(0, 8)));
  f.store.set('reconciliationBankAccountId', 'B');
  await f.read(new Date(instant(0, 9)));
  f.store.set('reconciliationBankAccountId', 'A');
  await f.read(new Date(instant(0, 10)));
  assert.equal(f.calls.at(-1).bankAccountId, 'A');
  assert.ok(f.calls.at(-1).updatedFrom);
});
