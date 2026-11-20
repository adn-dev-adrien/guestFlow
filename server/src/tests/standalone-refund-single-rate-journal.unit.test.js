// A plugin's refund of a sale booked at one rate (`role: 'refund'`, a `vatRate`, no VAT groups) reaches the journal as the mirror of that sale: the customer is credited, the
// revenue and the VAT are debited, to the cent. A sale of the same shape is untouched.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildStandaloneEntry } = require('../utils/accounting/accountingOutput');
const { create } = require('../utils/accounting/journalLines');
const { skipWithout } = require('../plugins/sdk/testing');

const NEEDS_PLAN = { skip: skipWithout(['accounting-export']) };

const journal = () => create({ accountPlan: require('../plugins/accounting-export/accountPlan') });
const sale = {
  key: 'plugin:1', date: '2026-11-18', totalCents: 0, booksCents: 15000, cardCents: 0, label: 'Remboursement', client: { firstName: '', lastName: 'Paul' }, vatRate: 10, invoiceNumber: null,
};
const shape = (lines) => lines.map((l) => [l.role, l.side, l.amountCents]);

test('a refund with one VAT rate mirrors the sale: customer credited, revenue and VAT debited', NEEDS_PLAN, () => {
  const entry = buildStandaloneEntry({ ...sale, role: 'refund' });
  assert.deepEqual([entry.kind, entry.standaloneRole], ['standaloneRefund', 'refund']);
  assert.deepEqual(shape(journal().entryLines(entry)), [['customer', 'credit', 15000], ['revenue:activities', 'debit', 13636], ['vat:10', 'debit', 1364]]);
});

test('a refund at a 0 % rate has no VAT line', NEEDS_PLAN, () => {
  const lines = journal().entryLines(buildStandaloneEntry({ ...sale, vatRate: 0, role: 'refund' }));
  assert.deepEqual(shape(lines), [['customer', 'credit', 15000], ['revenue:activities', 'debit', 15000]]);
});

test('the sale itself keeps its sides', NEEDS_PLAN, () => {
  const lines = journal().entryLines(buildStandaloneEntry(sale));
  assert.deepEqual(shape(lines), [['customer', 'debit', 15000], ['revenue:activities', 'credit', 13636], ['vat:10', 'credit', 1364]]);
});
