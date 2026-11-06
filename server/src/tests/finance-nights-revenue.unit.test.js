const test = require('node:test');
const assert = require('node:assert/strict');

// The clock is pinned for the whole file (specs/server-test-isolation.md rule 7).
require('node:test').mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 6, 11) });

// specs/finance-dashboard-redesign.md §3 rule 53 (D-HC9, 2026-11-06) — revenue per night and RevPAR read the
// revenue of the window's NIGHTS: each stay's total without its tourist tax, spread over its nights by the
// booking pace's split; never the cash-attributed revenue (review R3-1: RevPAR 55 € at 0 % occupancy).
const { freshDb, insert } = require('./financeDashboardFixture');
const { revenueOfNights, valueInMonth } = require('../utils/bookingPace');

const CREATED = '2024-01-02 10:00:00';
const one = () => freshDb({ properties: ['Gite'] });

test('rule 53 — a solde paid the month before the nights: the nights\' month carries their revenue', () => {
  const { db, dashboard } = one();
  // The logement's data starts in June (rule 24), so July is open, and sold nothing.
  insert(db, { id: 2, propertyId: 1, startDate: '2025-06-10', endDate: '2025-06-12', balanceAmount: 200, balancePaid: 1, balancePaidDate: '2025-06-12', createdAt: CREATED });
  // Nights 10-14 August 2025, solde paid 20 July: the revenue is attributed to July, the nights are in August.
  insert(db, { id: 1, propertyId: 1, startDate: '2025-08-10', endDate: '2025-08-14', balanceAmount: 400, balancePaid: 1, balancePaidDate: '2025-07-20', createdAt: CREATED });
  const august = dashboard.getDashboard({ fiscalYear: 2025, period: 'month', month: '2025-08' }).data.hero;
  assert.equal(august.revenue, 0, 'the page\'s revenue stays cash-attributed (rule 5)');
  assert.equal(august.revenuePerNight, 100, '400 € ÷ 4 nights');
  assert.equal(august.revPar, 12.9, '400 € ÷ 31 open nights');
  const july = dashboard.getDashboard({ fiscalYear: 2025, period: 'month', month: '2025-07' }).data.hero;
  assert.equal(july.occupancy, 0);
  assert.equal(july.revPar, 0, 'never a RevPAR above 0 € at 0 % occupancy');
  assert.equal(july.revenuePerNight, null, 'no night sold, no revenue per night');
});

test('rule 53 — the tourist tax is not revenue', () => {
  const { db, dashboard } = one();
  insert(db, { id: 1, propertyId: 1, startDate: '2025-06-01', endDate: '2025-06-05', finalPrice: 500, touristTaxTotal: 20, balanceAmount: 520, balancePaid: 1, balancePaidDate: '2025-06-05', createdAt: CREATED });
  const { hero } = dashboard.getDashboard({ fiscalYear: 2025, period: 'month', month: '2025-06' }).data;
  assert.equal(hero.revenue, 520, 'the page\'s revenue is unchanged');
  assert.equal(hero.revenuePerNight, 125, '500 € without the tax ÷ 4 nights');
  assert.equal(hero.revPar, 16.67, '500 € ÷ 30');
});

test('rule 53 — a stay across the window\'s edge brings the share of its nights inside', () => {
  const { db, dashboard } = one();
  insert(db, { id: 1, propertyId: 1, startDate: '2025-05-29', endDate: '2025-06-02', balanceAmount: 400, balancePaid: 1, balancePaidDate: '2025-06-02', createdAt: CREATED });
  const may = dashboard.getDashboard({ fiscalYear: 2025, period: 'month', month: '2025-05' }).data;
  const june = dashboard.getDashboard({ fiscalYear: 2025, period: 'month', month: '2025-06' }).data;
  assert.equal(may.hero.revenuePerNight, 100, '3 nights in May, 300 €');
  assert.equal(june.hero.revenuePerNight, 100, '1 night in June, 100 €');
  assert.equal(may.hero.revPar, 9.68, '300 € ÷ 31');
  assert.equal(june.hero.revPar, 3.33, '100 € ÷ 30');
});

test('rule 53 — one figure everywhere: the strip, the tile, the « Logements » table and the comparison', () => {
  const { db, dashboard } = freshDb({ properties: ['Gite', 'Tente'] });
  insert(db, { id: 1, propertyId: 1, startDate: '2024-07-01', endDate: '2024-07-05', balanceAmount: 400, balancePaid: 1, balancePaidDate: '2024-07-05', createdAt: CREATED });
  insert(db, { id: 2, propertyId: 1, startDate: '2025-07-01', endDate: '2025-07-04', balanceAmount: 450, balancePaid: 1, balancePaidDate: '2025-06-20', createdAt: CREATED });
  insert(db, { id: 3, propertyId: 2, startDate: '2025-07-10', endDate: '2025-07-12', balanceAmount: 200, balancePaid: 1, balancePaidDate: '2025-07-12', createdAt: CREATED });
  const params = { fiscalYear: 2025, period: 'month', month: '2025-07' };
  const d = dashboard.getDashboard(params).data;
  const detail = dashboard.getDashboardDetail('properties', params).data;
  assert.equal(d.hero.revenuePerNight, 130, '(450 + 200) € ÷ 5 nights');
  assert.equal(detail.totals.revenuePerNight, d.hero.revenuePerNight);
  assert.equal(detail.totals.revPar, d.hero.revPar);
  assert.equal(d.properties[0].revenuePerNight, 150);
  assert.equal(detail.rows[0].revenuePerNight, d.properties[0].revenuePerNight);
  assert.equal(d.comparison.metrics.revenuePerNight.current, d.hero.revenuePerNight);
  assert.equal(d.comparison.metrics.revenuePerNight.previous, 100, 'July 2024: 400 € ÷ 4 nights');
  const gite = dashboard.getDashboard({ ...params, propertyId: 1 }).data;
  assert.equal(gite.tiles.properties.revPar, gite.hero.revPar);
  assert.equal(gite.hero.revPar, 14.52, '450 € ÷ 31');
});

test('rule 53 — one night split: the pace\'s month value is the shared helper\'s', () => {
  const stay = { startDate: '2025-01-30', endDate: '2025-02-03', totalSejour: 400 };
  assert.equal(valueInMonth(stay, '2025-01', 'revenue'), revenueOfNights(stay, '2025-01-01', '2025-01-31', 400));
  assert.equal(revenueOfNights(stay, '2025-01-01', '2025-01-31', 400), 200);
  assert.equal(revenueOfNights(stay, '2025-02-01', '2025-02-28', 400), 200);
  const dayUse = { startDate: '2025-03-10', endDate: '2025-03-10', totalSejour: 50 };
  assert.equal(revenueOfNights(dayUse, '2025-03-01', '2025-03-31', 50), 50, 'a stay without a night counts where it starts');
  assert.equal(revenueOfNights(dayUse, '2025-04-01', '2025-04-30', 50), 0);
});
