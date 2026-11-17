// specs/mollie-rolling-reserve-and-incoming-payments.md rule 28 — the libellé of a Mollie credit stays short: the settlement
// reference and the last 6 characters of Qonto's transaction id, never the 50-character id. And the Mollie facts of a month are
// read once for the response, whichever number of times its stream is built. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { entryToRows } = require('../accountingExport');
const { create: createController, __test: { mollieEntries } } = require('../controller');
const { DEFAULTS } = require('../settings');
const { FAR_YEAR: Y } = require('../../../tests/farYearFixture');

const PLAN = { ...DEFAULTS };
const credit = { kind: 'credit', date: `${Y}-12-23`, amountCents: 15744, settlementReference: 'T19274230.2512.01', qontoReference: 'solio-6791-1-transaction-019d1b2f-0abcde', libelle: 'VERSEMENT MOLLIE' };
const stub = (counter) => ({
  encaissementsByMonth: () => [],
  mollieByMonth: () => { counter.n += 1; return { entries: [credit], unattached: [], clearing: { asOf: `${Y}-12-31`, balanceCents: 0, clients: [] } }; },
});

test('rule 28 — a credit\'s libellé is « VERSEMENT MOLLIE <settlement> <last 6 of the Qonto reference> »', () => {
  const [entry] = mollieEntries(stub({ n: 0 }), { month: 12, year: Y }, PLAN).entries;
  const [debit] = entryToRows(entry, PLAN);
  assert.equal(debit[5], 'VERSEMENT MOLLIE T19274230.2512.01 0abcde');
  assert.ok(debit[5].length <= 45);
});

test('rule 28 — the JSON of a month reads the Mollie facts once, whatever it builds from them', () => {
  const counter = { n: 0 };
  const controller = createController(stub(counter), { plan: () => PLAN });
  const res = { body: null, status() { return this; }, json(b) { this.body = b; return this; } };
  controller.salesJson({ query: { month: '12', year: String(Y) } }, res);
  assert.equal(counter.n, 1);
  assert.equal(res.body.mollie.clearing.account, DEFAULTS.mollieClearingAccount);
});
