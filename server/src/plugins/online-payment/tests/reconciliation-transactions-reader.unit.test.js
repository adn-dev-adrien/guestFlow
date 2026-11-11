// specs/qonto-bank-reconciliation.md rules 3, 5–7 — reading the account into the plugin's table.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { up } = require('../reconciliation/schema');
const { createBankTransactionsModel } = require('../reconciliation/bankTransactionsModel');
const { readTransactions, firstReadFrom } = require('../reconciliation/transactionsReader');
const { buildQontoClient } = require('../../../utils/qonto/qontoClient');

const credit = (id, cents, over = {}) => ({
  id, amountCents: cents, currency: 'EUR', side: 'credit', status: 'completed', operationType: 'income',
  label: 'Booking.com B.V.', counterpartyName: 'Booking.com B.V.', reference: 'NO.x', note: '', settledAt: '2026-10-12T05:00:00.000Z',
  emittedAt: '2026-10-12T04:00:00.000Z', updatedAt: '2026-10-12T05:00:00.000Z', ...over,
});

function fixture({ pages = [[credit('a', 100)]] } = {}) {
  const db = new Database(':memory:');
  up(db);
  const model = createBankTransactionsModel(db);
  const store = new Map();
  const settings = { get: (k) => store.get(k) || '', set: (k, v) => store.set(k, v) };
  const calls = [];
  const client = {
    listBankAccounts: async () => [{ id: 'acc-1', name: 'Compte principal', iban: 'FR76SECRET', main: true }],
    listTransactions: async (args) => {
      calls.push(args);
      const i = (args.page || 1) - 1;
      return { transactions: pages[i] || [], nextPage: i + 1 < pages.length ? i + 2 : null };
    },
  };
  const withQonto = async (fn) => fn(client, 'token');
  return { db, model, settings, store, calls, withQonto };
}

test('rule 5 — the first read goes back 13 months before the start date and follows the pages', async () => {
  const f = fixture({ pages: [[credit('a', 100)], [credit('b', 200)]] });
  const out = await readTransactions({ withQonto: f.withQonto, model: f.model, settings: f.settings, startDate: '2026-10-22', now: () => new Date('2026-10-22T10:00:00Z') });
  assert.equal(out.ok, true);
  assert.equal(out.read, 2);
  assert.equal(f.calls[0].settledFrom, '2025-09-22T00:00:00.000Z');
  assert.equal(f.calls.length, 2);
  assert.equal(f.model.count(), 2);
  assert.equal(f.store.get('reconciliationBankAccountId'), 'acc-1', 'the main account by default (rule 4)');
  assert.equal(firstReadFrom('2026-03-31'), '2025-02-28T00:00:00.000Z', 'a shorter month clamps, it never reads later than asked');
});

test('rule 5 — later reads are incremental from the last read minus one day', async () => {
  const f = fixture();
  await readTransactions({ withQonto: f.withQonto, model: f.model, settings: f.settings, startDate: '2026-10-22', now: () => new Date('2026-10-22T10:00:00Z') });
  f.calls.length = 0;
  await readTransactions({ withQonto: f.withQonto, model: f.model, settings: f.settings, startDate: '2026-10-22', now: () => new Date('2026-10-23T10:00:00Z') });
  assert.equal(f.calls[0].updatedFrom, '2026-10-21T10:00:00.000Z');
  assert.equal(f.calls[0].settledFrom, undefined);
});

test('rule 3 — only completed credits are stored', async () => {
  const f = fixture({ pages: [[credit('a', 100), credit('b', 100, { side: 'debit' }), credit('c', 100, { status: 'pending' })]] });
  await readTransactions({ withQonto: f.withQonto, model: f.model, settings: f.settings, startDate: '2026-10-22' });
  assert.deepEqual(f.model.listForAccount('acc-1').map((t) => t.id), ['a']);
});

test('rule 6 — no IBAN is stored anywhere', async () => {
  const f = fixture();
  await readTransactions({ withQonto: f.withQonto, model: f.model, settings: f.settings, startDate: '2026-10-22' });
  const dump = JSON.stringify(f.db.prepare('SELECT * FROM bank_transactions').all()) + JSON.stringify([...f.store.entries()]);
  assert.equal(dump.includes('FR76SECRET'), false);
});

test('rule 7 — a Qonto failure keeps the stored data and records the failure', async () => {
  const f = fixture();
  await readTransactions({ withQonto: f.withQonto, model: f.model, settings: f.settings, startDate: '2026-10-22' });
  const failing = async () => { throw new Error('Qonto indisponible'); };
  const out = await readTransactions({ withQonto: failing, model: f.model, settings: f.settings, startDate: '2026-10-22', now: () => new Date('2026-10-23T10:00:00Z') });
  assert.equal(out.ok, false);
  assert.equal(f.model.count(), 1, 'stored data untouched');
  assert.match(JSON.parse(f.store.get('reconciliationLastError')).message, /Qonto indisponible/);
  assert.notEqual(f.store.get('reconciliationLastReadAt'), '2026-10-23T10:00:00.000Z', 'the last successful read is not moved');
});

test('rule 5 — the Qonto client asks for completed credits, newest first, paginated', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    return { ok: true, status: 200, text: async () => JSON.stringify({ transactions: [{ transaction_id: 't1', amount_cents: 12345, side: 'credit', status: 'completed', label: 'X', settled_at: '2026-10-12T05:00:00Z' }], meta: { next_page: 2 } }) };
  };
  const client = buildQontoClient({ sandbox: true, fetchImpl, clientId: 'c', clientSecret: 's' });
  const page = await client.listTransactions({ accessToken: 'tok', bankAccountId: 'acc-1', settledFrom: '2025-09-22T00:00:00.000Z', page: 1 });
  assert.equal(page.nextPage, 2);
  assert.equal(page.transactions[0].amountCents, 12345);
  const url = new URL(seen[0]);
  assert.equal(url.pathname, '/v2/transactions');
  assert.equal(url.searchParams.get('side'), 'credit');
  assert.equal(url.searchParams.get('status[]'), 'completed');
  assert.equal(url.searchParams.get('bank_account_id'), 'acc-1');
  assert.equal(url.searchParams.get('settled_at_from'), '2025-09-22T00:00:00.000Z');
});
