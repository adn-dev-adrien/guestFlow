// Le mois comptable réunit encaissements, avoirs ET indemnités d'annulation dans un seul flux
// chronologique — CSV et aperçu JSON compris (specs/cancellation-compensation.md §3.3 rule 15).
// Building the stream in the controller is what keeps the two outputs from drifting apart.

const test = require('node:test');
const assert = require('node:assert/strict');

const accountingController = require('../controllers/accountingController');
const { CSV_HEADERS } = require('../utils/accountingExport');

const ACCOUNT = CSV_HEADERS.indexOf('Compte');

function fakeRes() {
  return {
    statusCode: 200, body: null, headers: {}, sent: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    send(buffer) { this.sent = buffer; return this; },
  };
}

const saleEntry = {
  reservationId: 1, kind: 'balance', paidDate: '2026-08-10',
  client: { firstName: 'Camille', lastName: 'Durand' }, propertyName: 'Gîte', platform: 'direct',
  clientGrossAmount: null, finalPrice: 480, encaissementTtc: 480, encaissementNetTtc: 480,
  commission: null, taxTtc: 0, fraction: 1,
  buckets: [{ name: 'accommodation', ht: 436.36, vat: 43.64, ratePercent: 10 }],
};

const compensationEntry = {
  compensationId: 3, reservationId: 12, kind: 'compensation', direction: 'compensation',
  paidDate: '2026-08-05', client: { firstName: 'Claire', lastName: 'Notin' },
  propertyName: 'Le Lodge', platform: 'Airbnb',
  clientGrossAmount: null, finalPrice: 84, encaissementTtc: 84, encaissementNetTtc: 84,
  commission: null, taxTtc: 0, fraction: 1, buckets: [],
  compensation: { account: '75880000', ht: 84, vat: 0, ratePercent: 0, startDate: '2026-09-04', endDate: '2026-09-07' },
};

function controllerWith({ compensations = [], sales = [saleEntry] } = {}) {
  const model = {
    encaissementsByMonth: () => sales,
    refundsByMonth: () => [],
    compensationsByMonth: () => compensations,
  };
  return accountingController.create(model);
}

test('a banked compensation appears in the JSON journal, sorted at its own date', () => {
  const controller = controllerWith({ compensations: [compensationEntry] });
  const res = fakeRes();
  controller.salesJson({ query: { month: '8', year: '2026' } }, res);
  assert.equal(res.statusCode, 200);
  const kinds = res.body.entries.map((e) => [e.paidDate, e.direction]);
  // 05/08 (indemnité) before 10/08 (solde) — one chronological stream, not two appended lists.
  assert.deepEqual(kinds, [['2026-08-05', 'compensation'], ['2026-08-10', 'sale']]);
  assert.equal(res.body.entries[0].balanced, true);
});

test('the same compensation appears in the CSV — the two outputs cannot drift', () => {
  const controller = controllerWith({ compensations: [compensationEntry] });
  const res = fakeRes();
  controller.salesCsv({ query: { month: '8', year: '2026' } }, res);
  const csv = res.sent.toString('latin1');
  const lines = csv.trim().split('\n').slice(1).map((l) => l.split(';'));
  assert.equal(lines.some((cells) => cells[ACCOUNT] === '75880000'), true);
  assert.equal(lines.some((cells) => cells[ACCOUNT] === 'CNOTIN'), true);
});

test('no compensation in the month → the journal is exactly what it was before', () => {
  const withNone = controllerWith({ compensations: [] });
  const res = fakeRes();
  withNone.salesJson({ query: { month: '8', year: '2026' } }, res);
  assert.equal(res.body.entries.length, 1);
  assert.equal(res.body.entries[0].direction, 'sale');
});

test('an accounting model that predates compensations still exports (no hard dependency)', () => {
  const controller = accountingController.create({
    encaissementsByMonth: () => [saleEntry],
    refundsByMonth: () => [],
  });
  const res = fakeRes();
  controller.salesJson({ query: { month: '8', year: '2026' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.entries.length, 1);
});

test('the debit/credit totals of the month include the compensation', () => {
  const controller = controllerWith({ compensations: [compensationEntry] });
  const res = fakeRes();
  controller.salesJson({ query: { month: '8', year: '2026' } }, res);
  assert.equal(res.body.totals.totalDebits, res.body.totals.totalCredits);
  assert.equal(res.body.totals.totalDebits, 564);
  assert.equal(res.body.totals.entriesCount, 2);
  assert.equal(res.body.totals.allBalanced, true);
});
