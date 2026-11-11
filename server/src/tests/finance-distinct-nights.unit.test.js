const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rule 35 — a night of a logement is sold once, however many
// stays cover it (an iCal duplicate of a platform booking, a fiche entered twice); revenue per night
// divides by the nights of the stays that carry an amount; the stays with 0 € on the books are named
// (mega review #5, M1: Gîte October 29 % for 5 distinct nights out of 31).
const { freshDb, insert, THIS_YEAR } = require('./financeDashboardFixture');
const occupancy = require('../utils/financeOccupancy');
const pace = require('../utils/bookingPace');
const { buildInsights } = require('../utils/financeInsights');

const Y = THIS_YEAR - 1;

test('rule 35 — nightsSold counts distinct nights per logement', () => {
  const stays = [
    { propertyId: 1, startDate: `${Y}-10-09`, endDate: `${Y}-10-11` },
    { propertyId: 1, startDate: `${Y}-10-09`, endDate: `${Y}-10-11` },
    { propertyId: 1, startDate: `${Y}-10-10`, endDate: `${Y}-10-12` },
    { propertyId: 2, startDate: `${Y}-10-09`, endDate: `${Y}-10-11` },
  ];
  assert.equal(occupancy.nightsSold(stays, `${Y}-10-01`, `${Y}-10-31`), 5, 'Gîte 9, 10, 11 + Lodge 9, 10');
  assert.equal(occupancy.nightsSold(stays, `${Y}-10-10`, `${Y}-10-10`), 2);
});

test('rule 35 — stayNights: priced nights, and the 0 € stays with their uncovered nights', () => {
  const n = occupancy.stayNights([
    { propertyId: 1, startDate: `${Y}-10-09`, endDate: `${Y}-10-11`, totalSejour: 652 },
    { propertyId: 1, startDate: `${Y}-10-09`, endDate: `${Y}-10-11`, totalSejour: 0 },
    { propertyId: 1, startDate: `${Y}-10-20`, endDate: `${Y}-10-23`, totalSejour: 0 },
  ]);
  assert.equal(n.nights, 5);
  assert.equal(n.pricedNights, 2);
  assert.deepEqual(n.unpriced, { count: 2, nights: 3 });
  assert.equal(n.byProperty.get(1).nights, 5);
});

test('rule 35 — dashboard: duplicates neither inflate nights nor dilute revenue per night', () => {
  const { db, dashboard } = freshDb();
  insert(db, { platform: 'Booking', startDate: `${Y}-10-09`, endDate: `${Y}-10-11`, balanceAmount: 652, createdAt: `${Y - 1}-01-01 10:00:00` });
  insert(db, { platform: 'Airbnb', startDate: `${Y}-10-09`, endDate: `${Y}-10-11`, balanceAmount: 0, createdAt: `${Y - 1}-01-01 10:00:00` });
  insert(db, { platform: 'Lodgify', startDate: `${Y}-10-09`, endDate: `${Y}-10-11`, balanceAmount: 0, createdAt: `${Y - 1}-01-01 10:00:00` });
  const d = dashboard.getDashboard({ fiscalYear: Y }).data;
  assert.equal(d.hero.nights, 2);
  assert.equal(d.hero.revenuePerNight, 326);
  const gite = d.occupancy.find((o) => o.propertyId === 1).months.find((m) => m.month === `${Y}-10`);
  assert.equal(Math.round(gite.current * 1000), Math.round((2 / 31) * 1000));
  const unpriced = d.insights.find((i) => i.key === 'unpriced');
  assert.equal(unpriced.title, '2 séjours sans montant');
  assert.match(unpriced.text, /doublons à vérifier/);
  assert.deepEqual(unpriced.action, { label: 'Voir les séjours', tile: 'stays', scope: 'unpriced' });

  const detail = dashboard.getDashboardDetail('stays', { fiscalYear: Y, scope: 'unpriced' }).data;
  assert.equal(detail.scope, 'unpriced');
  assert.equal(detail.rows.length, 2);
  assert.ok(detail.rows.every((r) => r.totalSejour === 0));
});

test('rule 35 — a 0 € stay alone says its nights have no revenue', () => {
  const out = buildInsights({ bestMonth: null, direct: null, late: { count: 0, amount: 0 }, unpriced: { count: 1, nights: 3 } });
  const u = out.find((i) => i.key === 'unpriced');
  assert.equal(u.tone, 'warning');
  assert.match(u.text, /3 nuits sans revenu/);
  assert.equal(buildInsights({ bestMonth: null, direct: null, late: { count: 0, amount: 0 }, unpriced: { count: 0, nights: 0 } }).some((i) => i.key === 'unpriced'), false);
});

test('rule 35 — pace nights are distinct nights too', () => {
  const at = `${Y}-10-01`;
  const stays = [
    { propertyId: 1, startDate: `${Y}-10-09`, endDate: `${Y}-10-11`, totalSejour: 652, bookedOn: `${Y}-01-01` },
    { propertyId: 1, startDate: `${Y}-10-09`, endDate: `${Y}-10-11`, totalSejour: 0, bookedOn: `${Y}-01-01` },
  ];
  const data = pace.buildPace({ stays, today: at, metric: 'nights', coverageMonth: null });
  const oct = (data.months || []).find((m) => m.month === `${Y}-10`);
  assert.equal(oct.current, 2);
});
