const test = require('node:test');
const assert = require('node:assert/strict');

// The clock is pinned for the whole file (specs/server-test-isolation.md rule 7): « today » is the day the
// comparisons were written against, so no date below is ever passed by the calendar.
require('node:test').mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 5, 11) });

// specs/finance-revpar-year-over-year.md §3 rule 14 — the dashboard payload only GAINS fields: every
// field it had before this spec keeps its value. The pin was produced by the dashboard model as it was
// before the change (inte/plugins 5437951d), on the fixed fixture of financeComparisonFixture.js.
// specs/finance-dashboard-redesign.md rule 53 (D-HC9) — revenue per night and RevPAR changed basis on purpose and
// are compared elsewhere (finance-nights-revenue.unit.test.js); every other field stays as pinned.
const pin = require('./fixtures/finance-dashboard-payload-pin.json');
const { pinnedDashboard, withoutAdded, withoutSuperseded, ADDED } = require('./financeComparisonFixture');

for (const [name, expected] of Object.entries(pin)) {
  test(`rule 14 — « ${name} »: every existing field of the dashboard keeps its value`, () => {
    const { dashboard } = pinnedDashboard();
    const d = dashboard.getDashboard(expected.params).data;
    assert.deepEqual(withoutAdded(d), withoutAdded(expected.dashboard));
  });

  test(`rule 14 — « ${name} »: the detail tables are unchanged`, () => {
    const { dashboard } = pinnedDashboard();
    assert.deepEqual(withoutSuperseded(dashboard.getDashboardDetail('properties', expected.params).data), withoutSuperseded(expected.properties));
    assert.deepEqual(dashboard.getDashboardDetail('collected', expected.params).data, expected.collected);
  });
}

test('rule 14 — the added fields are exactly the documented ones', () => {
  const { dashboard } = pinnedDashboard();
  const d = dashboard.getDashboard(pin.fy.params).data;
  const pinned = pin.fy.dashboard;
  assert.deepEqual(Object.keys(d.hero).filter((k) => !(k in pinned.hero)).sort(), [...ADDED.hero].sort());
  assert.deepEqual(Object.keys(d).filter((k) => !(k in pinned) && k !== 'fiscalYears').sort(), [...ADDED.data].sort());
});
