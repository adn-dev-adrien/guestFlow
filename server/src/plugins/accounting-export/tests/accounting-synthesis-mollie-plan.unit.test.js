// specs/accounting/accounting-synthesis.md rule 4 and specs/payments/mollie-rolling-reserve-and-incoming-payments.md rule 29 (stabilisation loop t10 B10-3,
// 2026-11-17) — the synthesis reads the very rows the CSV writes: with « Exporter les versements Mollie reçus » off, the Mollie bank lines
// leave the synthesis as they leave the CSV, and the Mollie rows ride on the accounts the operator set. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
const db = require('../../../database');
const { create: createSynthesisModel } = require('../synthesisModel');
const { buildSynthesis } = require('../synthesisController');
const { DEFAULTS } = require('../settings');
const { FAR_YEAR: Y } = require('../../../tests/farYearFixture');

const FACTS = [
  { kind: 'link', date: `${Y}-05-03`, amountCents: 4500, reservationId: 7, client: { firstName: 'Marc', lastName: 'Exemple' }, libelle: 'Marc Exemple' },
  { kind: 'credit', date: `${Y}-05-09`, amountCents: 3340, settlementReference: 'T1.2705.01', qontoReference: 'q-000001', libelle: 'VERSEMENT MOLLIE' },
];
const accounting = { encaissementsByMonth: () => [], mollieByMonth: () => ({ entries: FACTS, unattached: [], clearing: null }) };
const model = () => createSynthesisModel(db, { accountingModel: accounting, finance: {}, dashboard: {}, paymentLinks: {} });
const kinds = (entries) => entries.filter((e) => e.direction === 'mollie').map((e) => e.mollieKind).sort();

test('rule 29 — « Exporter les versements Mollie reçus » off: the synthesis drops the credit lines, like the CSV', () => {
  assert.deepEqual(kinds(model().entriesBetween(`${Y}-05-01`, `${Y}-05-31`, { ...DEFAULTS, mollieExportBank: '0' })), ['link']);
  assert.deepEqual(kinds(model().entriesBetween(`${Y}-05-01`, `${Y}-05-31`, { ...DEFAULTS })), ['credit', 'link']);
});

test('rule 4 — the Mollie rows of the synthesis ride on the operator\'s own accounts', () => {
  const [link] = model().entriesBetween(`${Y}-05-01`, `${Y}-05-31`, { ...DEFAULTS, mollieClearingAccount: '46799999' }).filter((e) => e.mollieKind === 'link');
  assert.equal(JSON.stringify(link).includes('46799999'), true);
});

test('rule 4 — the synthesis controller hands its plan to the model', () => {
  const seen = [];
  const plan = { ...DEFAULTS, mollieExportBank: '0' };
  const double = {
    today: () => `${Y}-06-15`, fiscalEndMonth: () => 12, meansResolver: () => () => 'recorded',
    entriesBetween: (from, to, given) => { seen.push(given); return []; },
    summary: () => ({ revenueTotalHt: 0, revenueTotal: 0, showHt: true, reservations: [], fiscalYears: [] }),
    touristTax: () => ({ amount: 0, stays: 0 }),
    lastYearRange: () => ({ range: null, snapshotKnown: true, knownN1: null, status: { comparable: false, reason: null, notice: null, comparableFrom: null } }),
    lastCsvExport: () => null, regimesDuring: () => [],
  };
  buildSynthesis(double, { period: 'month', month: `${Y}-05` }, plan);
  assert.ok(seen.length > 0 && seen.every((given) => given === plan));
});
