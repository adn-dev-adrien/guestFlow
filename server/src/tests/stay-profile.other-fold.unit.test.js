const test = require('node:test');
const assert = require('node:assert/strict');

// specs/stay-profile.md §3 rules 29 and 30 (verification V5-3, V5-11) — past five channels the tail
// folds into one « Autres » row, shares still add up to 100; the exercise served is always one of the
// selector's options.
const { freshDb, insert, TODAY } = require('./financeDashboardFixture');
const stayProfileModel = require('../models/stayProfileModel');
const { foldTail } = require('../utils/stayProfile');
const fiscalYearUtil = require('../utils/fiscalYear');
const { addDays } = require('../utils/financeOccupancy');

const at = (n) => addDays(TODAY, n);
const WINDOW = { period: 'custom', from: at(-60), to: at(10) };

test('rule 29 — seven channels: four by rank, then « Autres » holding the rest, shares to 100', () => {
  const { db } = freshDb();
  insert(db, { startDate: at(-400), endDate: at(-398), createdAt: `${at(-400)} 12:00:00`, balanceAmount: 100 });
  const platforms = [['direct', 900], ['Airbnb', 700], ['Booking', 500], ['GitesDeFrance', 400], ['Abracadaroom', 300], ['Abritel', 60], ['GreenGo', 50]];
  platforms.forEach(([platform, amount], i) => insert(db, { platform, startDate: at(-30 + i), endDate: at(-28 + i), createdAt: `${at(-40)} 12:00:00`, balanceAmount: amount }));
  const data = stayProfileModel.buildModel(db).getStayProfile(WINDOW).data;
  const rows = data.dimensions.find((d) => d.key === 'channel').rows;
  assert.deepEqual(rows.map((r) => [r.label, r.count, r.amount]), [
    ['Direct', 1, 900], ['Airbnb', 1, 700], ['Booking', 1, 500], ['Gîtes de France', 1, 400], ['Autres', 3, 410],
  ]);
  const other = rows[4];
  assert.deepEqual([other.key, other.other, other.parts], ['other', true, ['Abracadaroom', 'Abritel', 'GreenGo']]);
  assert.ok(rows.slice(0, 4).every((r) => r.other === undefined && r.parts === undefined));
  assert.equal(rows.reduce((n, r) => n + r.countPercent, 0), 100);
  assert.equal(rows.reduce((n, r) => n + r.amountPercent, 0), 100);
  assert.equal(Math.round(rows.reduce((n, r) => n + r.amount, 0) * 100), Math.round(data.totals.amount * 100));
});

test('rule 29 — five rows or fewer are left alone; the fixed dimensions never fold', () => {
  const five = [1, 2, 3, 4, 5].map((n) => ({ key: `k${n}`, label: `L${n}`, count: n, cents: n * 100 }));
  assert.equal(foldTail(five), five);
  const six = [...five, { key: 'k6', label: 'L6', count: 6, cents: 600 }];
  assert.deepEqual(foldTail(six).map((r) => r.key), ['k1', 'k2', 'k3', 'k4', 'other']);
  assert.deepEqual(foldTail(six)[4], { key: 'other', label: 'Autres', other: true, parts: ['L5', 'L6'], count: 11, cents: 1100 });
});

test('rule 30 — an exercise before the first one with data is still listed among the options', () => {
  const { db } = freshDb();
  insert(db, { startDate: at(-3), endDate: at(-1), balanceAmount: 100 });
  const current = fiscalYearUtil.containing(12, TODAY);
  const data = stayProfileModel.buildModel(db).getStayProfile({ fiscalYear: current.key - 3 }).data;
  assert.equal(data.fiscalYear.key, current.key - 3);
  assert.ok(data.fiscalYears.some((f) => f.key === current.key - 3));
  assert.deepEqual(data.fiscalYears.map((f) => f.key), [...data.fiscalYears.map((f) => f.key)].sort((a, b) => b - a));
});
