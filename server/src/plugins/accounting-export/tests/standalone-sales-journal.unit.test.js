// specs/resource-booking-pricing-and-invoicing.md rules 21-23 — a sale made outside any stay in the accountant's journal:
// its part on the books, at its frozen VAT rate, the Qonto invoice number as « Pièce ».
const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const { buildStandaloneEntry } = require('../accountingModel');
const { entryToRows, entryToStructured } = require('../accountingExport');
const { monthEntries } = require('../controller');
const { FAR_YEAR: Y } = require('../../../tests/farYearFixture');

const sale = (over = {}) => ({
  key: 'resource-booking:5', date: `${Y}-11-09`, totalCents: 12000, booksCents: 12000, cardCents: 12000,
  label: `Bain du 09/11/${Y}`, client: { firstName: 'Claire', lastName: 'Martin' }, vatRate: 20, invoiceNumber: `F-${Y}-0142`, ...over,
});
const cols = (rows) => rows.map((r) => [r[4], r[5], r[6], r[7], r[8]]);

test('rule 21 — debit the client of the TTC, credit « Activité diverse » of the HT and the VAT of its rate', () => {
  const rows = entryToRows(buildStandaloneEntry(sale()));
  assert.deepEqual(cols(rows), [
    [`F-${Y}-0142`, 'CLAIRE MARTIN', 'CMARTIN', 120, 0],
    [`F-${Y}-0142`, 'CLAIRE MARTIN', '70601000', 0, 100],
    [`F-${Y}-0142`, 'CLAIRE MARTIN', '44571200', 0, 20],
  ]);
  assert.deepEqual([rows[0][0], rows[0][1], rows[0][2]], [9, 11, Y]);
});

test('rule 21 — only the part on the books, and no VAT line for a sale without VAT', () => {
  const rows = entryToRows(buildStandaloneEntry(sale({ booksCents: 7000, vatRate: null, invoiceNumber: null })));
  assert.deepEqual(cols(rows), [
    ['', 'CLAIRE MARTIN', 'CMARTIN', 70, 0],
    ['', 'CLAIRE MARTIN', '70601000', 0, 70],
  ]);
});

test('rule 22 — « Pièce » is the Qonto number, empty without an invoice; the preview names the sale', () => {
  const structured = entryToStructured(buildStandaloneEntry(sale()));
  assert.deepEqual(structured.standalone, { label: `Bain du 09/11/${Y}`, invoiceNumber: `F-${Y}-0142` });
  assert.equal(structured.lines.reduce((s, l) => s + (l.debit || 0), 0), structured.lines.reduce((s, l) => s + (l.credit || 0), 0));
});

test('rules 21, 23 — the month stream carries the sales of every live plugin, all caisse interne left out', () => {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  try {
    createContext('hourly-resources', { settingsModel: () => ({}) }).standaloneSales(() => [sale(), sale({ key: 'resource-booking:6', booksCents: 0 })]);
    const { standaloneSalesByMonth } = require('../accountingModel').create(require('better-sqlite3')(':memory:'), { settings: { read: () => ({}) } });
    const accountingModel = { encaissementsByMonth: () => [], standaloneSalesByMonth };
    const entries = monthEntries(accountingModel, { year: Y, month: 11 }).filter((e) => e.direction === 'standalone');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].encaissementTtc, 120);
  } finally {
    registry.reset();
  }
});
