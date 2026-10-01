const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rules 23-25 — occupancy = nights sold ÷ sellable nights,
// closures removed (global or per logement, end exclusive), no data = no rate; revenue per night, RevPAR.
const { sellableNights, nightsSold, occupancyOver, revenuePerNight, revPar } = require('../utils/financeOccupancy');

test('rule 24 — a closure removes its nights, end date exclusive, global or own logement only', () => {
  const closures = [
    { propertyId: null, startDate: '2026-01-05', endDate: '2026-01-10' },
    { propertyId: 2, startDate: '2026-01-20', endDate: '2026-02-03' },
  ];
  assert.equal(sellableNights(1, '2026-01-01', '2026-01-31', closures), 31 - 5);
  assert.equal(sellableNights(2, '2026-01-01', '2026-01-31', closures), 31 - 5 - 12);
  assert.equal(sellableNights(1, '2026-01-01', '2026-01-31', []), 31);
});

test('rule 24 — nights sold are counted in the month they fall in', () => {
  const stays = [{ propertyId: 1, startDate: '2026-01-30', endDate: '2026-02-03' }];
  assert.equal(nightsSold(stays, '2026-01-01', '2026-01-31'), 2);
  assert.equal(nightsSold(stays, '2026-02-01', '2026-02-28'), 2);
});

test('rules 23-24 — a closed month and a month before the data are gaps, never 0 %', () => {
  const props = [{ id: 1 }, { id: 2 }];
  const stays = [{ propertyId: 1, startDate: '2026-04-10', endDate: '2026-04-13' }];
  const closures = [{ propertyId: 2, startDate: '2026-04-01', endDate: '2026-05-01' }];
  const startOf = (p) => (p.id === 1 ? '2026-04-01' : '2026-01-01');
  const april = occupancyOver(props, stays, closures, '2026-04-01', '2026-04-30', { startOf });
  assert.equal(april.byProperty.get(1).rate, 0.1);
  assert.equal(april.byProperty.get(2).rate, null);
  assert.equal(april.rate, 0.1);
  const march = occupancyOver(props, stays, [], '2026-03-01', '2026-03-31', { startOf });
  assert.equal(march.byProperty.get(1).rate, null);
  assert.equal(march.byProperty.get(2).rate, 0);
});

test('rule 24 — a longer window is not diluted by the months before the data', () => {
  const stays = [{ propertyId: 1, startDate: '2026-04-01', endDate: '2026-04-16' }];
  const o = occupancyOver([{ id: 1 }], stays, [], '2026-01-01', '2026-04-30', { startOf: () => '2026-04-01' });
  assert.equal(o.rate, 0.5);
});

test('rule 25 — revenue per night sold and RevPAR, guarded against ÷ 0', () => {
  assert.equal(revenuePerNight(1000, 8), 125);
  assert.equal(revenuePerNight(1000, 0), null);
  assert.equal(revPar(1000, 40), 25);
  assert.equal(revPar(1000, 0), null);
});
