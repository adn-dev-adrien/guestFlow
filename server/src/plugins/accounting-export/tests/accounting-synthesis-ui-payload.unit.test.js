// specs/accounting-synthesis.md §3 rules 14, 16, 22 and 25 — what the « Synthèse » screen needs ready-made: the
// periods the selector offers, the tile's main VAT rate, the last export's month in words, the shares as fractions
// of 1. The clock is pinned for the whole file: the dates are inputs of a model double.
const test = require('node:test');
const assert = require('node:assert/strict');

test.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 5, 12) });

process.env.DB_PATH = ':memory:';
const { buildSynthesis } = require('../synthesisController');
const { periodOptions } = require('../synthesisPeriod');

const TODAY = '2026-11-05';
const sale = (paidDate, rate, ttc) => ({
  reservationId: 1, kind: 'balance', paidDate, client: { lastName: 'Lima' }, platform: 'direct', clientGrossAmount: null,
  finalPrice: ttc, encaissementTtc: ttc, encaissementNetTtc: ttc, taxTtc: 0, fraction: 1,
  buckets: [{ name: 'accommodation', ht: Math.round((ttc / (1 + rate / 100)) * 100) / 100, vat: Math.round((ttc - ttc / (1 + rate / 100)) * 100) / 100, ratePercent: rate }],
});
const model = ({ entries = [], fiscalYears = [{ key: 2026, label: '2026', from: '2026-01-01', to: '2026-12-31', isCurrent: true }], stamp = null } = {}) => ({
  today: () => TODAY,
  fiscalEndMonth: () => 12,
  meansResolver: () => () => 'recorded',
  entriesBetween: (from, to) => entries.filter((e) => e.paidDate >= from && e.paidDate <= to),
  summary: () => ({ revenueTotalHt: 0, revenueTotal: 0, showHt: true, reservations: [], fiscalYears }),
  touristTax: () => ({ amount: 0, stays: 0 }),
  lastYearRange: () => ({ range: null, snapshotKnown: false, knownN1: null, status: { comparable: false, reason: 'noHistory', notice: 'x', comparableFrom: null } }),
  lastCsvExport: () => stamp,
  regimeInForce: () => ({ regime: 'subject', rate: 10, legalMention: null }),
});

test('rule 22 — the selector offers every month and quarter from the oldest exercise to the server\'s month, newest first', () => {
  const options = periodOptions({ firstMonth: '2025-11', lastMonth: '2026-02' });
  assert.deepEqual(options.months.map((m) => m.value), ['2026-02', '2026-01', '2025-12', '2025-11']);
  assert.deepEqual(options.months[0], { value: '2026-02', label: 'février 2026' });
  assert.deepEqual(options.quarters, [{ value: '2026-Q1', label: 'T1 2026' }, { value: '2025-Q4', label: 'T4 2025' }]);

  const data = buildSynthesis(model({ fiscalYears: [
    { key: 2026, label: '2026', from: '2026-01-01', to: '2026-12-31', isCurrent: true },
    { key: 2025, label: '2025', from: '2025-01-01', to: '2025-12-31', isCurrent: false },
  ] }), { period: 'month', month: '2026-10' }).data;
  assert.equal(data.periodOptions.months[0].value, '2026-11', 'up to the server\'s month');
  assert.equal(data.periodOptions.months.at(-1).value, '2025-01', 'from the oldest exercise');
  assert.equal(data.periodOptions.quarters[0].value, '2026-Q4');
  assert.deepEqual(data.fiscalYears.map((f) => f.key), [2026, 2025]);
});

test('rule 22 — never before the entered-date window, and up to a window chosen ahead', () => {
  const data = buildSynthesis(model({ fiscalYears: [{ key: 2018, label: '2018', from: '2018-01-01', to: '2018-12-31', isCurrent: false }] }), { period: 'quarter', quarter: '2027-Q2' }).data;
  assert.equal(data.periodOptions.months.at(-1).value, '2021-11');
  assert.equal(data.periodOptions.months[0].value, '2027-06');
});

test('rule 25 — the VAT tile names the rate that carries the most VAT', () => {
  const data = buildSynthesis(model({ entries: [sale('2026-10-02', 20, 60), sale('2026-10-03', 10, 330)] }), { period: 'month', month: '2026-10' }).data;
  assert.deepEqual(data.kpis.vat.mainRate, { ratePercent: 10, vat: 30 });
  assert.equal(buildSynthesis(model(), { period: 'month', month: '2026-10' }).data.kpis.vat.mainRate, null);
});

test('rule 16 — the last export carries its month in words', () => {
  const data = buildSynthesis(model({ stamp: { at: '2026-11-02T09:14', month: '2026-10' } }), { period: 'month', month: '2026-10' }).data;
  assert.deepEqual(data.checks.lastExport, { at: '2026-11-02T09:14', month: '2026-10', monthLabel: 'octobre 2026' });
});

test('rule 14 — every share also comes as a fraction of 1 for the bar, exactly the percent', () => {
  const data = buildSynthesis(model({ entries: [sale('2026-10-02', 10, 100), sale('2026-10-03', 10, 200)] }), { period: 'month', month: '2026-10' }).data;
  const row = data.collections.byType[0];
  assert.deepEqual([row.share, row.ratio], [100, 1]);
});
