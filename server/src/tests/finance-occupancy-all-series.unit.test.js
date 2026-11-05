const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-revpar-year-over-year.md §3 rule 12 — the monthly occupancy of « Tous les logements »
// (or the selected one), this year and last year month by month, null where not comparable.
const { pinnedDashboard } = require('./financeComparisonFixture');

const month = (series, ym) => series.months.find((m) => m.month === ym);

test('rule 12 — all logements: the scope\'s nights sold over its open nights, month by month', () => {
  const { dashboard } = pinnedDashboard();
  const d = dashboard.getDashboard({ fiscalYear: 2024 }).data;
  assert.equal(d.occupancyAll.months.length, 12);
  // August 2024: Tente 4 nights, Gite 0, 62 open nights; August 2023: Tente 3, 62.
  assert.deepEqual(month(d.occupancyAll, '2024-08'), { month: '2024-08', label: 'août 2024', initial: 'A', current: 0.0645, previous: 0.0484 });
  // December 2024: the Tente closed, Gite 2 nights over 31; last December: nothing sold, 62 open.
  assert.deepEqual([month(d.occupancyAll, '2024-12').current, month(d.occupancyAll, '2024-12').previous], [0.0645, 0]);
  assert.equal(d.occupancyAll.average, d.hero.occupancy, 'the exercise window: the average is the hero\'s rate');
});

test('rule 12 — a closed month is a gap, and a month without last year is null', () => {
  const { dashboard } = pinnedDashboard();
  const d = dashboard.getDashboard({ fiscalYear: 2024 }).data;
  assert.equal(month(d.occupancyAll, '2024-02').current, null, 'closed: no open night');
  assert.equal(month(d.occupancyAll, '2024-04').previous, null, 'April 2023 is before the data starts (May 2023)');
  assert.notEqual(month(d.occupancyAll, '2024-05').previous, null);
});

test('rule 12 — one logement selected: the all-logements series is that logement\'s', () => {
  const { dashboard } = pinnedDashboard();
  const d = dashboard.getDashboard({ fiscalYear: 2024, propertyId: 2 }).data;
  assert.equal(d.occupancy.length, 1);
  assert.deepEqual(d.occupancyAll.months, d.occupancy[0].months);
  assert.equal(d.occupancyAll.average, d.occupancy[0].average);
});
