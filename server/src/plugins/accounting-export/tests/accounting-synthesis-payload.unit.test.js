// specs/accounting-synthesis.md §3 rules 5, 8, 9, 19 and 21 — the payload the « Synthèse » tab renders, built on
// a model double: what each tile says without VAT, without a comparison, on a part of the window, and the source
// every panel names. The clock is pinned for the whole file: the dates are inputs of the double.
const test = require('node:test');
const assert = require('node:assert/strict');

test.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 5, 12) });

process.env.DB_PATH = ':memory:';
const { buildSynthesis } = require('../synthesisController');

const TODAY = '2026-11-05';
const saleOn = (paidDate, ttc = 110, rate = 10) => ({
  reservationId: 1, kind: 'balance', paidDate, client: { lastName: 'Lima' }, platform: 'direct', clientGrossAmount: null,
  finalPrice: ttc, encaissementTtc: ttc, encaissementNetTtc: ttc, taxTtc: 0, fraction: 1,
  buckets: rate > 0 ? [{ name: 'accommodation', ht: Math.round((ttc / (1 + rate / 100)) * 100) / 100, vat: Math.round((ttc - ttc / (1 + rate / 100)) * 100) / 100, ratePercent: rate }]
    : [{ name: 'accommodation', ht: ttc, vat: 0, ratePercent: 0 }],
});

function model({ entries = [], range = null, cover = '2024-01', regime = { regime: 'subject', rate: 10, legalMention: null }, revenue = () => 0 } = {}) {
  return {
    today: () => TODAY,
    fiscalEndMonth: () => 12,
    meansResolver: () => () => 'recorded',
    entriesBetween: (from, to) => entries.filter((e) => e.paidDate >= from && e.paidDate <= to),
    summary: ({ from, to }) => ({ revenueTotalHt: revenue(from, to), revenueTotal: revenue(from, to) * 1.1, showHt: true, reservations: [], fiscalYears: [{ key: 2026, label: '2026', isCurrent: true }] }),
    touristTax: (months) => ({ amount: months.length * 10, stays: months.length }),
    lastYearRange: () => ({ cover, range, snapshotKnown: true, knownN1: '2025-11-05' }),
    lastCsvExport: () => null,
    regimeInForce: () => regime,
  };
}

test('rule 5 — outside the VAT, the tile names the regime instead of a figure', () => {
  const franchise = { regime: 'not_subject', rate: 0, legalMention: 'art_293_b' };
  const data = buildSynthesis(model({ entries: [saleOn('2026-10-04', 100, 0)], regime: franchise }), { period: 'month', month: '2026-10' }).data;
  assert.equal(data.kpis.vat.amount, null);
  assert.deepEqual(data.kpis.vat.notSubject, { regime: 'not_subject', mention: 'art_293_b', label: 'Franchise en base de TVA' });
  assert.deepEqual(data.vatReturn.byRate, [{ ratePercent: 0, base: 100, vat: 0 }], 'the base is still shown');
  const exempt = buildSynthesis(model({ regime: { regime: 'not_subject', rate: 0, legalMention: 'art_261_d_4' } }), { period: 'month', month: '2026-10' }).data;
  assert.equal(exempt.kpis.vat.notSubject.label, 'Exonération de TVA');
});

test('rule 5 — VAT collected before a switch to the franchise is still due: the figure is shown', () => {
  const data = buildSynthesis(model({ entries: [saleOn('2026-10-04')], regime: { regime: 'not_subject', rate: 0, legalMention: 'art_293_b' } }), { period: 'month', month: '2026-10' }).data;
  assert.equal(data.kpis.vat.amount, 10);
  assert.equal(data.kpis.vat.notSubject, null);
  assert.deepEqual(data.kpis.vat.byRate, [{ ratePercent: 10, vat: 10 }]);
});

test('rule 9 — no comparison: one reason, no pill', () => {
  const fy = buildSynthesis(model(), { period: 'fy', fiscalYear: '2026' }).data;
  assert.equal(fy.comparison.reason, 'Pas d’exercice 2025 en base : la comparaison avec l’an dernier n’est pas affichée.');
  assert.deepEqual([fy.kpis.revenue.yoy, fy.kpis.collected.yoy, fy.kpis.touristTax.yoy, fy.kpis.vat.yoy], [null, null, null, null]);
  const empty = buildSynthesis(model({ cover: null }), { period: 'month', month: '2026-10' }).data;
  assert.equal(empty.comparison.reason, 'Aucun séjour en base : pas de comparaison avec l’an dernier.');
  assert.equal(empty.comparison.comparable, false);
});

test('rule 9 — compared on the comparable part only, both sides, with a note', () => {
  const range = {
    current: { from: '2026-03-01', to: '2026-10-31' }, previous: { from: '2025-03-01', to: '2025-10-31' }, months: 8, totalMonths: 10, complete: false,
  };
  const entries = [saleOn('2026-01-10', 220), saleOn('2026-04-10', 110), saleOn('2025-04-10', 55)];
  const revenue = (from) => (from.startsWith('2026-01') ? 300 : (from.startsWith('2026-03') ? 200 : 100));
  const data = buildSynthesis(model({ entries, range, revenue }), { period: 'custom', from: '2026-01-01', to: '2026-10-31' }).data;
  assert.equal(data.comparison.note, 'Comparaison sur 8 mois sur 10.');
  assert.equal(data.kpis.collected.amount, 330, 'the tile keeps the whole window');
  assert.deepEqual(data.kpis.collected.yoy, { current: 110, previous: 55, change: 100 });
  assert.deepEqual(data.kpis.revenue.yoy, { current: 200, previous: 100, change: 100 });
  assert.deepEqual(data.kpis.vat.yoy, { current: 10, previous: 5, change: 100 });
  assert.deepEqual(data.kpis.touristTax.yoy, { current: 80, previous: 80, change: 0 }, 'eight months a side');
  assert.equal(data.collections.series.previousAvailable, false, 'last year\'s running total only over a whole comparable window');
});

test('rule 9 — last year at zero gives no percentage, never an infinite one', () => {
  const range = { current: { from: '2026-10-01', to: '2026-10-31' }, previous: { from: '2025-10-01', to: '2025-10-31' }, months: 1, totalMonths: 1, complete: true };
  const data = buildSynthesis(model({ entries: [saleOn('2026-10-04')], range }), { period: 'month', month: '2026-10' }).data;
  assert.deepEqual(data.kpis.collected.yoy, { current: 110, previous: 0, change: null });
  assert.equal(data.collections.series.previousAvailable, true);
  assert.equal(data.collections.series.buckets.at(-1).previousCumulative, 0);
});

test('rule 8 — a cut month has no tourist-tax figure, only its reason', () => {
  const data = buildSynthesis(model(), { period: 'custom', from: '2026-10-02', to: '2026-10-31' }).data;
  assert.deepEqual([data.kpis.touristTax.amount, data.kpis.touristTax.stays], [null, null]);
  assert.equal(data.kpis.touristTax.reason, 'La taxe de séjour se déclare par mois entiers.');
  assert.equal(buildSynthesis(model(), { period: 'quarter', quarter: '2026-Q3' }).data.kpis.touristTax.amount, 30);
});

test('rule 19 — every tile and panel names its source, stays or collections, never both', () => {
  const data = buildSynthesis(model({ entries: [saleOn('2026-10-04')] }), { period: 'month', month: '2026-10' }).data;
  assert.deepEqual(
    Object.fromEntries(Object.entries(data.kpis).map(([k, v]) => [k, v.source])),
    { revenue: 'stays', collected: 'collections', touristTax: 'stays', vat: 'collections' },
  );
  assert.equal(data.vatReturn.source, 'collections');
  assert.equal(data.collections.source, 'collections');
  assert.deepEqual([data.checks.balanced.source, data.checks.vatCoherence.source, data.checks.settled.source], ['collections', 'collections', 'stays']);
});

test('rule 21 — every amount leaves rounded to the cent', () => {
  const entries = [saleOn('2026-10-04', 33.33), saleOn('2026-10-05', 33.33), saleOn('2026-10-06', 33.34)];
  const data = buildSynthesis(model({ entries }), { period: 'month', month: '2026-10' }).data;
  assert.equal(data.kpis.collected.amount, 100);
  const amounts = JSON.stringify(data).match(/"(amount|base|vat|total|cumulative)":-?\d+\.\d+/g) || [];
  for (const a of amounts) assert.match(a, /\.\d{1,2}$/, a);
});
