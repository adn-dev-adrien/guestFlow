const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-revpar-year-over-year.md §3 rules 1, 2 and 3 — RevPAR = the page's revenue ÷ the open
// nights of the window, the open nights being the occupancy denominator itself (closures and nights
// before a logement's data excluded); the revenue per night sold is the existing figure.
const { freshDb, insert } = require('./financeDashboardFixture');
const { pinnedDashboard, LONG_AGO } = require('./financeComparisonFixture');

test('rule 1 — exercise 2024, closures excluded: 581 open nights, RevPAR 1 400 € ÷ 581', () => {
  const { dashboard } = pinnedDashboard();
  const { hero } = dashboard.getDashboard({ fiscalYear: 2024 }).data;
  // Gite: 366 − 60 (January + February, global closure) = 306; Tente: 306 − 31 (December) = 275.
  assert.equal(hero.openNights, 581);
  // Gite 6 + 2 + 2 (30-31 December of a stay attributed to 2025), Tente 4 + 3.
  assert.equal(hero.occupiedNights, 17);
  assert.equal(hero.occupancy, 0.0293, 'occupancy is occupiedNights ÷ openNights');
  assert.equal(hero.revPar, 2.41);
  assert.equal(hero.revenuePerNight, 107.69, 'the revenue per night sold is unchanged (1 400 € ÷ 13 priced nights)');
});

test('rule 2 — one logement: the hero RevPAR is the « Logements » tile\'s and the detail\'s', () => {
  const { dashboard } = pinnedDashboard();
  const d = dashboard.getDashboard({ fiscalYear: 2024, propertyId: 1 }).data;
  assert.equal(d.hero.openNights, 306);
  assert.equal(d.hero.revPar, 2.29, '700 € ÷ 306');
  assert.equal(d.tiles.properties.revPar, d.hero.revPar);
  const detail = dashboard.getDashboardDetail('properties', { fiscalYear: 2024, propertyId: 1 }).data;
  assert.equal(detail.totals.revPar, d.hero.revPar);
  const all = dashboard.getDashboard({ fiscalYear: 2024 }).data;
  assert.equal(dashboard.getDashboardDetail('properties', { fiscalYear: 2024 }).data.totals.revPar, all.hero.revPar);
});

test('rule 3 — a window wholly closed has no RevPAR, never 0 €', () => {
  const { dashboard } = pinnedDashboard();
  const { hero } = dashboard.getDashboard({ fiscalYear: 2024, period: 'month', month: '2024-02' }).data;
  assert.equal(hero.openNights, 0);
  assert.equal(hero.occupancy, null);
  assert.equal(hero.revPar, null);
});

test('rule 1 — window edge: a stay across the window\'s end counts its nights inside only', () => {
  const { dashboard } = pinnedDashboard();
  const { hero } = dashboard.getDashboard({ fiscalYear: 2024, period: 'month', month: '2024-12', propertyId: 1 }).data;
  assert.equal(hero.openNights, 31);
  assert.equal(hero.occupiedNights, 2, '30 and 31 December, not 1 January');
});

test('rules 1 and 9 — leap year: 29 open nights in February 2028-style months, 28 a year back', () => {
  const { db, dashboard } = freshDb({ properties: ['Gite'] });
  insert(db, { id: 1, propertyId: 1, startDate: '2023-02-10', endDate: '2023-02-12', balanceAmount: 200, balancePaid: 1, balancePaidDate: '2023-02-12', createdAt: LONG_AGO });
  insert(db, { id: 2, propertyId: 1, startDate: '2024-02-10', endDate: '2024-02-15', balanceAmount: 500, balancePaid: 1, balancePaidDate: '2024-02-15', createdAt: LONG_AGO });
  const d = dashboard.getDashboard({ fiscalYear: 2024, period: 'month', month: '2024-02' }).data;
  assert.equal(d.hero.openNights, 29);
  assert.equal(d.hero.revPar, 17.24, '500 € ÷ 29');
  const m = d.comparison.metrics;
  assert.equal(d.comparison.complete, true);
  assert.deepEqual(d.comparison.previous, { from: '2023-02-01', to: '2023-02-28' });
  assert.equal(m.revPar.previous, 7.14, '200 € ÷ 28');
  assert.equal(m.revPar.change, 141.5);
  assert.equal(m.occupancy.current, 0.1724);
  assert.equal(m.occupancy.previous, 0.0714);
  assert.equal(m.occupancy.change, 10.1, 'points');
});
