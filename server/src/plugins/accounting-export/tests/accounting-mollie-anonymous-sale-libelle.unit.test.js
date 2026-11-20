// specs/mollie-rolling-reserve-and-incoming-payments.md rule 28 (stabilisation loop t10 B10-4, 2026-11-17) — a sale outside a stay paid through
// Mollie by a passage (no named client, no stay) books its « link » entry under the sale's label, never « RÉSERVATION #null ». Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { entryToRows } = require('../accountingExport');
const { __test: { mollieEntries } } = require('../controller');
const { DEFAULTS } = require('../settings');
const { FAR_YEAR: Y } = require('../../../tests/farYearFixture');

const PLAN = { ...DEFAULTS };
const linkOf = (over) => ({
  kind: 'link', date: `${Y}-07-14`, amountCents: 4500, reservationId: null, saleKey: `standalone:3:${Y}-07-14`, ledgerKey: `sale:standalone:3:${Y}-07-14:link-8`, ...over,
});
const rowsOf = (entry) => {
  const stub = { encaissementsByMonth: () => [], mollieByMonth: () => ({ entries: [entry], unattached: [], clearing: null }) };
  return entryToRows(mollieEntries(stub, { month: 7, year: Y }, PLAN).entries[0], PLAN);
};

test('rule 28 — an anonymous sale\'s Mollie link reads the sale\'s label', () => {
  const rows = rowsOf(linkOf({ client: { firstName: '', lastName: '' }, libelle: 'Vente hors séjour' }));
  rows.forEach((row) => assert.equal(row[5], 'VENTE HORS SÉJOUR'));
  rows.forEach((row) => assert.ok(!String(row[5]).includes('#null')));
});

test('rule 28 — with no label either, it still reads « VENTE HORS SÉJOUR »', () => {
  rowsOf(linkOf({ client: { firstName: '', lastName: '' }, libelle: '' })).forEach((row) => assert.equal(row[5], 'VENTE HORS SÉJOUR'));
});

test('rule 28 — a named client keeps his name, a stay keeps its own fallback', () => {
  rowsOf(linkOf({ client: { firstName: 'Marc', lastName: 'Exemple' }, libelle: 'Marc Exemple' })).forEach((row) => assert.equal(row[5], 'MARC EXEMPLE'));
  rowsOf(linkOf({ reservationId: 42, saleKey: null, client: { firstName: '', lastName: '' }, libelle: '' })).forEach((row) => assert.equal(row[5], 'RÉSERVATION #42'));
});
