const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// specs/finance-exercise-overview-charts.md — the « vue de l'exercice » block of the Suivi financier:
// tiles, months, logements and channels over the whole selected exercise, all adding up to yearTotal.
const financeModel = require('../models/financeModel');
const {
  exerciseMonths, percentages, directShare, channelSlices, propertyRatios,
} = require('../utils/exerciseOverview');

const DDL = `
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL DEFAULT 10, fiscalYearEndMonth INTEGER NOT NULL DEFAULT 12);
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', clientId INTEGER, propertyId INTEGER,
    startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
    requestOrigin TEXT, attributionChannel TEXT, devisStatus TEXT, createdAt TEXT DEFAULT (datetime('now')),
    finalPrice REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0,
    depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositDueDate TEXT, depositDisabled INTEGER DEFAULT 0,
    balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balanceDueDate TEXT,
    complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0, complementPaidDate TEXT, complementPaidCash INTEGER DEFAULT 0,
    endOfStayComplementAmount REAL DEFAULT 0, endOfStayComplementPaid INTEGER DEFAULT 0,
    endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER DEFAULT 0,
    midStaySettledNotes TEXT,
    platformCommissionAmount REAL, acompteCommissionAmount REAL
  );
`;

const THIS_YEAR = new Date().getFullYear();

function freshModel(closingMonth = 12) {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id, vatRate, fiscalYearEndMonth) VALUES (1, 10, ?)').run(closingMonth);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite'), (2, 'Tente'), (3, 'Yourte')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  return { db, model: financeModel.buildModel(db) };
}

let nextId = 1;
function insert(db, r) {
  const row = {
    id: nextId++, kind: 'reservation', clientId: 1, propertyId: 1, platform: 'direct',
    requestOrigin: null, attributionChannel: null, balanceAmount: 0, ...r,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO reservations (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row);
}

// A past calendar exercise: every stay is attributed by its departure (no balancePaidDate column).
function seedPastYear(db, year) {
  insert(db, { platform: 'Airbnb', startDate: `${year}-01-10`, endDate: `${year}-01-13`, balanceAmount: 300 });
  insert(db, { platform: 'Lodgify', propertyId: 2, startDate: `${year}-07-01`, endDate: `${year}-07-05`, balanceAmount: 500 });
  insert(db, { requestOrigin: 'public', attributionChannel: 'social', startDate: `${year}-07-20`, endDate: `${year}-07-22`, balanceAmount: 400 });
  insert(db, { platform: 'Booking', startDate: `${year}-12-28`, endDate: `${year}-12-31`, balanceAmount: 250 });
  // Outside the exercise: must not leak into any figure.
  insert(db, { platform: 'Airbnb', startDate: `${year + 1}-01-01`, endDate: `${year + 1}-01-03`, balanceAmount: 999 });
}

const sum = (list, key) => Math.round(list.reduce((n, x) => n + x[key], 0) * 100) / 100;

test('rule 3 — months, logements and channels all add up to yearTotal', () => {
  const { db, model } = freshModel();
  const year = THIS_YEAR - 2;
  seedPastYear(db, year);
  const s = model.getSummary({ fiscalYear: year });
  const o = s.exerciseOverview;
  assert.equal(s.yearTotal, 1450);
  assert.equal(o.revenue, 1450);
  assert.equal(o.nights, s.yearTotalNights);
  assert.equal(sum(o.months, 'revenue'), 1450);
  assert.equal(sum(o.properties, 'revenue'), 1450);
  assert.equal(sum(o.channels, 'revenue'), 1450);
  assert.equal(sum(o.months, 'nights'), s.yearTotalNights);
});

test('rule 8 — twelve months in calendar order, each carrying its own stays', () => {
  const { db, model } = freshModel();
  const year = THIS_YEAR - 2;
  seedPastYear(db, year);
  const { months } = model.getSummary({ fiscalYear: year }).exerciseOverview;
  assert.equal(months.length, 12);
  assert.deepEqual(months.map((m) => m.initial).join(''), 'JFMAMJJASOND');
  assert.equal(months[0].month, `${year}-01`);
  assert.equal(months[0].label, `janvier ${year}`);
  assert.equal(months[0].revenue, 300);
  assert.equal(months[6].revenue, 900);
  assert.equal(months[11].revenue, 250);
  assert.equal(months[3].revenue, 0);
});

test('rule 8 — a September closing starts the axis in October', () => {
  const { model } = freshModel(9);
  const { months } = model.getSummary({ fiscalYear: THIS_YEAR }).exerciseOverview;
  assert.equal(months.length, 12);
  assert.equal(months[0].month, `${THIS_YEAR - 1}-10`);
  assert.equal(months[11].month, `${THIS_YEAR}-09`);
  assert.deepEqual(months.map((m) => m.initial).join(''), 'ONDJFMAMJJAS');
});

test('rule 9 — a closed exercise is all past, a future one all upcoming', () => {
  const { db, model } = freshModel();
  seedPastYear(db, THIS_YEAR - 2);
  seedPastYear(db, THIS_YEAR + 2);
  const past = model.getSummary({ fiscalYear: THIS_YEAR - 2 }).exerciseOverview.months;
  assert.equal(sum(past, 'upcoming'), 0);
  assert.equal(sum(past, 'past'), 1450);
  const future = model.getSummary({ fiscalYear: THIS_YEAR + 2 }).exerciseOverview.months;
  assert.equal(sum(future, 'past'), 0);
  assert.equal(sum(future, 'upcoming'), 1450);
  for (const m of future) assert.equal(m.past + m.upcoming, m.revenue);
});

test('rule 6 — direct is the website plus saisie directe; an empty exercise has no percent', () => {
  const { db, model } = freshModel();
  const year = THIS_YEAR - 2;
  seedPastYear(db, year);
  const o = model.getSummary({ fiscalYear: year }).exerciseOverview;
  assert.deepEqual(o.direct, { revenue: 900, percent: 62 });
  const directSlice = o.channels.find((c) => c.key === 'direct');
  assert.equal(directSlice.revenue, 900);
  assert.equal(directSlice.reservations, 2);

  const empty = model.getSummary({ fiscalYear: THIS_YEAR - 5 }).exerciseOverview;
  assert.deepEqual(empty.direct, { revenue: 0, percent: null });
  assert.deepEqual(empty.channels, []);
  assert.deepEqual(empty.properties, []);
  assert.equal(empty.months.length, 12);
});

test('rule 12 — logements at 0 are dropped, each ratio is relative to the first', () => {
  const { db, model } = freshModel();
  const year = THIS_YEAR - 2;
  seedPastYear(db, year);
  const { properties } = model.getSummary({ fiscalYear: year }).exerciseOverview;
  assert.deepEqual(properties.map((p) => [p.propertyName, p.revenue, p.ratio]), [['Gite', 950, 1], ['Tente', 500, 0.526]]);
});

test('exerciseMonths — handles a year-crossing exercise and stops at its end', () => {
  const months = exerciseMonths('2025-10-01', '2026-09-30');
  assert.equal(months.length, 12);
  assert.equal(months[2].label, 'décembre 2025');
  assert.equal(months[3].month, '2026-01');
});

test('percentages — largest remainder always sums to 100', () => {
  assert.deepEqual(percentages([1, 1, 1]), [34, 33, 33]);
  assert.equal(percentages([18661, 9077, 8430, 7503, 5196]).reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(percentages([0, 0]), [null, null]);
});

test('rules 13-14 — at most five slices, the smallest folded into « Autres », no zero-revenue slice', () => {
  const agg = (key, group, label, revenue) => ({ key, group, label, revenue, reservations: 1 });
  const slices = channelSlices([
    agg('site:social', 'site', 'Réseaux sociaux', 300),
    agg('direct', 'direct', 'Direct (saisie)', 200),
    agg('platform:airbnb', 'platform', 'Airbnb', 400),
    agg('platform:booking', 'platform', 'Booking', 300),
    agg('platform:abritel', 'platform', 'Abritel', 200),
    agg('platform:greengo', 'platform', 'GreenGo', 60),
    agg('platform:pitchup', 'platform', 'Pitchup', 40),
    agg('platform:airbnb-ical', 'platform', 'Abracadaroom', 0),
  ]);
  assert.deepEqual(slices.map((s) => [s.label, s.revenue, s.reservations]), [
    ['Direct', 500, 2], ['Airbnb', 400, 1], ['Booking', 300, 1], ['Abritel', 200, 1], ['Autres', 100, 2],
  ]);
  assert.equal(slices.reduce((n, s) => n + s.percent, 0), 100);
  assert.equal(slices[0].platform, 'direct');
  assert.equal(slices[4].platform, null);
});

test('directShare and propertyRatios — pure helpers', () => {
  assert.deepEqual(directShare([{ group: 'platform', revenue: 100 }], 100), { revenue: 0, percent: 0 });
  assert.deepEqual(propertyRatios([{ propertyId: 1, propertyName: 'A', revenue: 0 }]), []);
});
