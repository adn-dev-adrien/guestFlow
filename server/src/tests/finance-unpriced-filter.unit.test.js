const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rule 39 — the « Sans montant » filter of « Réservations » counts
// the nights its insight announces (those no priced stay covers) and flags every 0 € stay so its payment
// chips read « Montant à saisir » (review of PR #702, minors 4 and 5: 15 nights in the insight, 17 in
// the table; « Réglé · Acompte non payé · Solde non payé » on each 0 € stay).
const { freshDb, insert, THIS_YEAR } = require('./financeDashboardFixture');

const Y = THIS_YEAR - 1;
const OLD = `${Y - 1}-01-01 10:00:00`;

test('rule 39 — the filter total counts the nights the insight announces', () => {
  const { db, dashboard } = freshDb();
  insert(db, { platform: 'Booking', startDate: `${Y}-10-09`, endDate: `${Y}-10-11`, balanceAmount: 652, createdAt: OLD });
  insert(db, { platform: 'Airbnb', startDate: `${Y}-10-09`, endDate: `${Y}-10-11`, balanceAmount: 0, createdAt: OLD }); // duplicate: covered
  insert(db, { platform: 'Airbnb', startDate: `${Y}-10-20`, endDate: `${Y}-10-23`, balanceAmount: 0, createdAt: OLD }); // 3 uncovered nights
  const d = dashboard.getDashboard({ fiscalYear: Y }).data;
  assert.match(d.insights.find((i) => i.key === 'unpriced').text.replace(/\s/g, ' '), /3 nuits sans revenu/);
  const detail = dashboard.getDashboardDetail('stays', { fiscalYear: Y, scope: 'unpriced' }).data;
  assert.equal(detail.totals.count, 2);
  assert.equal(detail.totals.nights, 3);
});

test('rule 39 — a 0 € stay is flagged amountMissing, a priced one is not', () => {
  const { db, dashboard } = freshDb();
  insert(db, { platform: 'Booking', startDate: `${Y}-10-09`, endDate: `${Y}-10-11`, balanceAmount: 652, createdAt: OLD });
  insert(db, { platform: 'Airbnb', startDate: `${Y}-10-20`, endDate: `${Y}-10-23`, balanceAmount: 0, createdAt: OLD });
  const unpriced = dashboard.getDashboardDetail('stays', { fiscalYear: Y, scope: 'unpriced' }).data;
  assert.deepEqual(unpriced.rows.map((r) => r.amountMissing), [true]);
  const all = dashboard.getDashboardDetail('stays', { fiscalYear: Y }).data;
  assert.deepEqual(all.rows.map((r) => [r.totalSejour > 0, r.amountMissing]).sort(), [[false, true], [true, false]]);
});
