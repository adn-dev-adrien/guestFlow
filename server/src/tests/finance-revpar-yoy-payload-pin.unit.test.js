const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-revpar-year-over-year.md §3 rule 14 — the dashboard payload only GAINS fields: every
// field it had before this spec keeps its value. The pin was produced by the dashboard model as it was
// before the change (inte/plugins 5437951d), on the fixed fixture of financeComparisonFixture.js.
const pin = require('./fixtures/finance-dashboard-payload-pin.json');
const { pinnedDashboard, withoutAdded, ADDED } = require('./financeComparisonFixture');

for (const [name, expected] of Object.entries(pin)) {
  test(`rule 14 — « ${name} »: every existing field of the dashboard keeps its value`, () => {
    const { dashboard } = pinnedDashboard();
    const d = dashboard.getDashboard(expected.params).data;
    assert.deepEqual(withoutAdded(d), expected.dashboard);
  });

  test(`rule 14 — « ${name} »: the detail tables are unchanged`, () => {
    const { dashboard } = pinnedDashboard();
    assert.deepEqual(dashboard.getDashboardDetail('properties', expected.params).data, expected.properties);
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
