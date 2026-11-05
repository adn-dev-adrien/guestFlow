const test = require('node:test');
const assert = require('node:assert/strict');

// specs/stay-profile.md §3 rules 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 and 15 — the « Profil
// des séjours »: the dashboard's window and logement filter, non-cancelled stays only, the four
// breakdowns and their bucket edges, shares adding up to 100, the monthly average basket against last
// year (tourist tax excluded) and the source of every panel.
const { freshDb, insert, TODAY } = require('./financeDashboardFixture');
const stayProfileModel = require('../models/stayProfileModel');
const {
  bucketOf, percentShares, leadDays, basketDelta, withoutTouristTax,
} = require('../utils/stayProfile');
const {
  LENGTH_BUCKETS, LEAD_BUCKETS, PRICE_BUCKETS,
} = require('../constants/stayProfileBuckets');
const { addDays } = require('../utils/financeOccupancy');
const yoy = require('../utils/yearOverYear');
const { MAX_CUSTOM_WINDOW_DAYS } = require('../utils/financeWindow');

const at = (n) => addDays(TODAY, n);
const stamp = (n) => `${at(n)} 12:00:00`;
const sumOf = (rows, key) => rows.reduce((n, r) => n + (r[key] || 0), 0);

// A window of 120 days around today, and the initial import far before it (so later booking days are trusted).
const WINDOW = { period: 'custom', from: at(-60), to: at(60) };
function setup() {
  const env = freshDb();
  env.profile = stayProfileModel.buildModel(env.db);
  insert(env.db, { startDate: at(-400), endDate: at(-398), createdAt: stamp(-400), balanceAmount: 100 });
  return env;
}
const dim = (data, key) => data.dimensions.find((d) => d.key === key).rows;
const row = (data, key, bucket) => dim(data, key).find((r) => r.key === bucket);

test('rules 6-8 — bucket edges read their inclusive upper bound', () => {
  const key = (v, b) => bucketOf(v, b).key;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 30].map((n) => key(n, LENGTH_BUCKETS)), ['n1-2', 'n1-2', 'n3-4', 'n3-4', 'n5-6', 'n5-6', 'n7+', 'n7+']);
  assert.deepEqual([0, 6, 7, 30, 31, 90, 91, 400].map((n) => key(n, LEAD_BUCKETS)), ['d0-6', 'd0-6', 'd7-30', 'd7-30', 'd31-90', 'd31-90', 'd91+', 'd91+']);
  assert.deepEqual([1, 29999, 30000, 80000, 80001].map((c) => key(c, PRICE_BUCKETS)), ['p0-299', 'p0-299', 'p300-800', 'p300-800', 'p800+']);
});

test('rule 9 — whole percents add up to exactly 100, or none at all', () => {
  assert.deepEqual(percentShares([1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(percentShares([2, 1]), [67, 33]);
  assert.deepEqual(percentShares([1, 1, 1, 1, 1, 1, 1]).reduce((n, v) => n + v, 0), 100);
  assert.deepEqual(percentShares([0, 5, 0]), [0, 100, 0]);
  assert.deepEqual(percentShares([0, 0]), [null, null]);
  assert.deepEqual(percentShares([]), []);
  assert.deepEqual(percentShares([500, -100]), [null, null]);
});

test('rule 7 — the lead time: same day is 0, a fiche entered after arrival or on the import is unknown', () => {
  const start = at(10);
  const paceStart = at(-300);
  assert.equal(leadDays(at(10), start, paceStart), 0);
  assert.equal(leadDays(at(3), start, paceStart), 7);
  assert.equal(leadDays(at(11), start, paceStart), null);
  assert.equal(leadDays(at(-301), start, paceStart), null);
  assert.equal(leadDays(at(-300), start, paceStart), 310);
  assert.equal(leadDays(null, start, paceStart), null);
  assert.equal(leadDays(at(3), start, null), null);
});

test('rules 2, 4 and 9 — non-cancelled stays of the window, totals equal to the dashboard hero', () => {
  const { db, profile, dashboard } = setup();
  insert(db, { startDate: at(-10), endDate: at(-8), createdAt: stamp(-40), balanceAmount: 250 });
  insert(db, { startDate: at(5), endDate: at(12), createdAt: stamp(-100), balanceAmount: 900.5 });
  insert(db, { kind: 'cancelled', startDate: at(20), endDate: at(25), createdAt: stamp(-30), balanceAmount: 600 });
  insert(db, { kind: 'devis', startDate: at(20), endDate: at(25), createdAt: stamp(-30), balanceAmount: 700 });
  insert(db, { startDate: at(100), endDate: at(103), createdAt: stamp(-5), balanceAmount: 400 });
  const { data } = profile.getStayProfile(WINDOW);
  const hero = dashboard.getDashboard(WINDOW).data.hero;
  assert.deepEqual(data.totals, { count: 2, amount: 1150.5 });
  assert.equal(data.totals.count, hero.stays);
  assert.equal(data.totals.amount, hero.revenue);
  assert.equal(data.empty, false);
  assert.deepEqual(data.dimensions.map((d) => d.key), ['channel', 'length', 'lead', 'price']);
  for (const d of data.dimensions) {
    assert.equal(sumOf(d.rows, 'count'), 2, d.key);
    assert.equal(Math.round(sumOf(d.rows, 'amount') * 100), 115050, d.key);
    assert.equal(sumOf(d.rows, 'countPercent'), 100, d.key);
    assert.equal(sumOf(d.rows, 'amountPercent'), 100, d.key);
  }
  assert.equal(row(data, 'length', 'n1-2').count, 1);
  assert.equal(row(data, 'length', 'n7+').amount, 900.5);
  assert.equal(row(data, 'lead', 'd7-30').count, 1);
  assert.equal(row(data, 'lead', 'd91+').count, 1);
  assert.equal(row(data, 'price', 'p800+').amountPercent, 78);
  assert.equal(row(data, 'price', 'p0-299').amountPercent, 22);
});

test('rule 5 — channels: one « Direct » row for every own channel, platforms as the « Canaux » tile reads them, ranked by amount', () => {
  const { db, profile, dashboard } = setup();
  insert(db, { startDate: at(-20), endDate: at(-17), createdAt: stamp(-50), balanceAmount: 300 });
  insert(db, { startDate: at(-15), endDate: at(-13), createdAt: stamp(-50), balanceAmount: 200, requestOrigin: 'public', attributionChannel: 'search' });
  insert(db, { startDate: at(-12), endDate: at(-9), createdAt: stamp(-50), balanceAmount: 700, platform: 'Airbnb', platformCommissionAmount: 100 });
  insert(db, { startDate: at(-8), endDate: at(-6), createdAt: stamp(-50), balanceAmount: 450, platform: 'Booking', platformCommissionAmount: 50 });
  insert(db, { startDate: at(-5), endDate: at(-3), createdAt: stamp(-50), balanceAmount: 420, platform: 'Booking', platformCommissionAmount: 20 });
  const { data } = profile.getStayProfile(WINDOW);
  const channels = dim(data, 'channel');
  assert.deepEqual(channels.map((c) => [c.label, c.count, c.amount]), [['Booking', 2, 800], ['Airbnb', 1, 600], ['Direct', 2, 500]]);
  assert.equal(sumOf(channels, 'countPercent'), 100);
  assert.deepEqual(channels.map((c) => c.amountBar), [1, 0.75, 0.625]);
  assert.deepEqual(channels.map((c) => c.countBar), [1, 0.5, 1]);
  // Same figures as the « Canaux » tile of the dashboard.
  const tile = dashboard.getDashboardDetail('channels', WINDOW).data;
  const directTile = tile.site.subtotal.revenue + tile.others.filter((r) => r.group === 'direct').reduce((n, r) => n + r.revenue, 0);
  assert.equal(channels.find((c) => c.key === 'direct').amount, directTile);
  for (const p of tile.others.filter((r) => r.group === 'platform')) {
    const mine = channels.find((c) => c.key === p.key);
    assert.deepEqual([mine.label, mine.count, mine.amount], [p.label, p.reservations, p.revenue]);
  }
});

test('rule 7 — a fiche created after its arrival and a stay of the initial import have no lead time', () => {
  const { db, profile } = setup();
  insert(db, { startDate: at(-30), endDate: at(-28), createdAt: stamp(-27), balanceAmount: 100 });
  insert(db, { startDate: at(-20), endDate: at(-18), createdAt: stamp(-20), balanceAmount: 100 });
  insert(db, { startDate: at(-15), endDate: at(-12), createdAt: stamp(-400), balanceAmount: 100 });
  const { data } = profile.getStayProfile(WINDOW);
  const lead = dim(data, 'lead');
  assert.deepEqual(lead.map((r) => r.key), ['d0-6', 'd7-30', 'd31-90', 'd91+', 'unknown']);
  assert.equal(row(data, 'lead', 'unknown').count, 2);
  assert.equal(row(data, 'lead', 'unknown').label, 'Date de réservation inconnue');
  assert.equal(row(data, 'lead', 'd0-6').count, 1);
});

test('rules 8 and 10 — a stay at 0 € is « Sans montant », listed last and only when it holds a stay', () => {
  const { db, profile } = setup();
  insert(db, { startDate: at(-10), endDate: at(-8), createdAt: stamp(-40), balanceAmount: 300 });
  let { data } = profile.getStayProfile(WINDOW);
  assert.deepEqual(dim(data, 'price').map((r) => r.key), ['p0-299', 'p300-800', 'p800+']);
  assert.equal(row(data, 'price', 'p300-800').count, 1);
  insert(db, { startDate: at(-6), endDate: at(-4), createdAt: stamp(-40), balanceAmount: 0 });
  ({ data } = profile.getStayProfile(WINDOW));
  assert.deepEqual(dim(data, 'price').map((r) => r.key), ['p0-299', 'p300-800', 'p800+', 'unpriced']);
  assert.deepEqual([row(data, 'price', 'unpriced').count, row(data, 'price', 'unpriced').amountPercent], [1, 0]);
});

test('rule 3 — the logement filter narrows every breakdown', () => {
  const { db, profile } = setup();
  insert(db, { propertyId: 1, startDate: at(-10), endDate: at(-8), createdAt: stamp(-40), balanceAmount: 250 });
  insert(db, { propertyId: 2, startDate: at(-10), endDate: at(-3), createdAt: stamp(-40), balanceAmount: 900 });
  const { data } = profile.getStayProfile({ ...WINDOW, propertyId: '2' });
  assert.equal(data.propertyId, 2);
  assert.deepEqual(data.totals, { count: 1, amount: 900 });
  assert.equal(row(data, 'length', 'n7+').count, 1);
  assert.deepEqual(data.properties.map((p) => p.name), ['Gite', 'Tente', 'Yourte']);
});

test('rule 4 — an empty window: every fixed bucket at 0, no share, no channel', () => {
  const { profile } = setup();
  const { data } = profile.getStayProfile(WINDOW);
  assert.equal(data.empty, true);
  assert.deepEqual(data.totals, { count: 0, amount: 0 });
  assert.deepEqual(dim(data, 'channel'), []);
  assert.deepEqual(dim(data, 'length').map((r) => [r.count, r.countPercent, r.amountPercent, r.countBar]), [[0, null, null, 0], [0, null, null, 0], [0, null, null, 0], [0, null, null, 0]]);
  assert.equal(dim(data, 'lead').length, 4);
});

test('rule 1 — the dashboard\'s window and its refusals', () => {
  const { profile, dashboard } = setup();
  const same = (params) => {
    const a = profile.getStayProfile(params);
    const b = dashboard.getDashboard(params);
    assert.deepEqual([a.ok, a.status, a.error], [b.ok, b.status, b.error]);
    return a;
  };
  assert.equal(same({ period: 'custom', from: at(10), to: at(1) }).error, 'La date de début doit précéder la date de fin.');
  assert.equal(same({ period: 'custom', from: at(0), to: '' }).error, 'Deux dates à choisir.');
  assert.equal(same({ period: 'custom', from: `${TODAY.slice(0, 4)}-02-30`, to: at(1) }).error, 'Deux dates à choisir.');
  assert.equal(same({ period: 'custom', from: at(-MAX_CUSTOM_WINDOW_DAYS - 1), to: at(0) }).status, 400);
  assert.equal(same({ period: 'week' }).error, 'Période inconnue.');
  assert.equal(same({ propertyId: '99' }).error, 'Logement inconnu.');
  assert.equal(same({ period: 'month', month: '1999-01' }).status, 400);
  const fy = same({});
  assert.equal(fy.data.window.kind, 'fy');
  assert.deepEqual(fy.data.window, dashboard.getDashboard({}).data.window);
});

test('rules 11-15 — the average basket: tourist tax excluded, last year beside it on comparable months', () => {
  const env = setup();
  const { db, profile } = env;
  // This month: two stays, one carrying 30 € of tourist tax in its 330 €.
  insert(db, { startDate: at(-3), endDate: at(0), createdAt: stamp(-30), balanceAmount: 330, finalPrice: 300, touristTaxTotal: 30 });
  insert(db, { startDate: at(-6), endDate: at(0), createdAt: stamp(-30), balanceAmount: 500, finalPrice: 500 });
  // The same day last year, booked before then (known as it stood a year ago).
  const lastYear = yoy.shiftYear(TODAY, -1);
  insert(db, { startDate: addDays(lastYear, -2), endDate: lastYear, createdAt: stamp(-380), balanceAmount: 320, finalPrice: 320 });
  const { data } = profile.getStayProfile({});
  const { basket } = data;
  assert.equal(basket.source, 'stays');
  assert.equal(basket.sourceLabel, 'Sur les montants des séjours, hors taxe de séjour');
  assert.equal(basket.excludesTouristTax, true);
  assert.equal(basket.comparable, true);
  assert.equal(basket.notice, null);
  assert.equal(basket.currentLabel, data.fiscalYear.label);
  assert.equal(basket.previousLabel, data.fiscalYear.previousLabel);
  const now = basket.rows.find((r) => r.month === TODAY.slice(0, 7));
  assert.deepEqual(now.current, { stays: 2, revenue: 800, average: 400 });
  assert.deepEqual(now.previous, { stays: 1, revenue: 320, average: 320 });
  assert.deepEqual(now.delta, { amount: 80, change: 25, trend: 'up' });
  // The dashboard's own N-1 reading of that month is untouched by the shared helper (rule 12).
  const chart = env.dashboard.getDashboard({}).data.revenueMonths.find((m) => m.month === TODAY.slice(0, 7));
  assert.deepEqual([chart.revenue, chart.previous], [830, 320]);
  // The breakdowns keep the tax (they read the page's « total de séjour »).
  const panels = profile.getStayProfile(WINDOW).data;
  assert.equal(panels.totals.amount, 830);
  assert.ok(panels.dimensions.every((d) => d.source === 'stays' && d.sourceLabel === 'Sur les montants des séjours'));
  // Every listed month holds a stay on one side at least.
  assert.ok(basket.rows.every((r) => r.current.stays > 0 || (r.previous && r.previous.stays > 0)));
});

test('rules 12-13 — no history a year back: no N-1, no delta, one notice', () => {
  const env = freshDb();
  const profile = stayProfileModel.buildModel(env.db);
  insert(env.db, { startDate: at(-3), endDate: at(0), createdAt: stamp(-30), balanceAmount: 400, finalPrice: 400 });
  const { basket } = profile.getStayProfile({}).data;
  assert.equal(basket.comparable, false);
  assert.match(basket.notice, /^Historique depuis .+ : pas encore d'an dernier à comparer\.$/);
  const now = basket.rows.find((r) => r.month === TODAY.slice(0, 7));
  assert.deepEqual([now.current.average, now.previous, now.delta], [400, null, null]);
});

test('rule 12 — before a year of booking dates, a month not over has no N-1 (dashboard rule 33)', () => {
  assert.equal(yoy.lastYearReading('2026-10', { today: '2026-11-05', snapshotKnown: false }), 'final'); // date-literal-ok: a pure function of its input
  assert.equal(yoy.lastYearReading('2026-11', { today: '2026-11-05', snapshotKnown: false }), null); // date-literal-ok: a pure function of its input
  assert.equal(yoy.lastYearReading('2026-11', { today: '2026-11-05', snapshotKnown: true }), 'knownAt'); // date-literal-ok: a pure function of its input
});

test('rules 12 and 14 — the delta and the tax split on their edges', () => {
  assert.equal(basketDelta({ average: 300 }, { average: null }), null);
  assert.equal(basketDelta({ average: null }, { average: 300 }), null);
  assert.equal(basketDelta({ average: 300 }, null), null);
  assert.deepEqual(basketDelta({ average: 300 }, { average: 300 }), { amount: 0, change: 0, trend: 'stable' });
  assert.deepEqual(basketDelta({ average: 270 }, { average: 300 }), { amount: -30, change: -10, trend: 'down' });
  assert.equal(withoutTouristTax({ totalSejour: 330, finalPrice: 300, touristTaxTotal: 30 }), 300);
  assert.equal(withoutTouristTax({ totalSejour: 297, finalPrice: 300, touristTaxTotal: 30 }), 270);
  assert.equal(withoutTouristTax({ totalSejour: 150, finalPrice: 0, touristTaxTotal: 0 }), 150);
  assert.equal(withoutTouristTax({ totalSejour: 150 }), 150);
});
