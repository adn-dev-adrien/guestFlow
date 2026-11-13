// specs/pricing-components.md rule 63 — the neutral role lines of a journal entry (C15): roles and cents, no account, no column.
const test = require('node:test');
const assert = require('node:assert/strict');
const accountPlan = require('../accountPlan');
const { create } = require('../../../utils/accounting/journalLines');
const csvJournal = require('../../../utils/accounting/exporters/csvJournal').create({ accountPlan });

const { entryLines, accountOf } = create({ accountPlan });

const sale = {
  direction: 'sale',
  paidDate: '2026-05-10',
  client: { firstName: 'A', lastName: 'B' },
  encaissementTtc: 220,
  encaissementNetTtc: 200,
  taxTtc: 0,
  fraction: 1,
  finalPrice: 220,
  commission: { ttc: 20, ht: 20, vat: 0, hasVat: false, account: '622700', vatAccount: '445660' },
  platform: 'x',
  buckets: [{ name: 'accommodation', ht: 200, vat: 20, ratePercent: 10, ttc: 220 }],
};

test('a sale is a customer debit, a commission debit, revenue by class and VAT by rate', () => {
  const lines = entryLines(sale);
  assert.deepEqual(lines.map((l) => [l.role, l.side, l.amountCents]), [
    ['customer', 'debit', 20000], ['commission', 'debit', 2000], ['revenue:accommodation', 'credit', 20000], ['vat:10', 'credit', 2000],
  ]);
  assert.equal(lines[2].vatRate, 10);
  assert.ok(lines.every((l) => !('credit' in l) && !('debit' in l)), 'no CSV column leaks into a role line');
});

test('the lines balance to the cent and the CSV rows are the lines on their accounts', () => {
  const lines = entryLines(sale);
  const sum = (side) => lines.filter((l) => l.side === side).reduce((a, l) => a + l.amountCents, 0);
  assert.equal(sum('debit'), sum('credit'));
  const rows = csvJournal.entryToRows(sale);
  assert.deepEqual(rows.map((r) => [r[6], r[7], r[8]]), [[accountPlan.buildClientAccount('B'), 200, 0], ['622700', 20, 0], [accountOf(lines[2], null), 0, 200], [accountOf(lines[3], null), 0, 20]]);
});

test('a refund mirrors the sale and a negative closing leg is a credit', () => {
  const refund = { direction: 'refund', paidDate: '2026-06-01', client: { lastName: 'B' }, encaissementTtc: 100, taxTtc: 0, buckets: [{ name: 'accommodation', ht: 90.91, vat: 9.09, ratePercent: 10 }] };
  assert.deepEqual(entryLines(refund).map((l) => [l.role, l.side]), [['customer', 'credit'], ['revenue:accommodation', 'debit'], ['vat:10', 'debit']]);
  const closing = { ...refund, encaissementTtc: 10, closing: [{ role: 'revenue', account: '709000', ratePercent: 0, amount: 12 }, { role: 'touristTax', amount: -2 }] };
  const lines = entryLines(closing);
  assert.deepEqual(lines.map((l) => [l.role, l.side, l.amountCents, l.account]), [
    ['customer', 'credit', 1000, undefined], ['revenue:closing', 'debit', 1200, '709000'], ['touristTax', 'credit', 200, undefined],
  ]);
});

test('the small kinds name their own class', () => {
  const base = { paidDate: '2026-06-01', client: { lastName: 'B' }, encaissementTtc: 50 };
  assert.deepEqual(entryLines({ ...base, direction: 'tip' }).map((l) => l.role), ['customer', 'revenue:tip']);
  assert.deepEqual(entryLines({ ...base, direction: 'penalty' }).map((l) => l.role), ['penalty', 'customer']);
  assert.deepEqual(entryLines({ ...base, direction: 'standalone', vatRatePercent: 20 }).map((l) => l.role), ['customer', 'revenue:activities', 'vat:20']);
  assert.deepEqual(entryLines({ ...base, direction: 'compensation', compensation: { ht: 50, vat: 0, ratePercent: 0 } }).map((l) => l.role), ['customer', 'revenue:compensation']);
});
