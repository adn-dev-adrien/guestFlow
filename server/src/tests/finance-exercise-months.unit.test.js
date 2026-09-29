const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rule 22 — the months of the selected exercise, revenue split
// « encaissé ou passé » / « à venir », as getSummary builds them in its exercise loop (so they add up
// to yearTotal by construction). Carried over from finance-exercise-overview-charts.md rules 3, 8, 9.
const { freshDb, insert, sum, THIS_YEAR } = require('./financeDashboardFixture');

function seedPastYear(db, year) {
  insert(db, { platform: 'Airbnb', startDate: `${year}-01-10`, endDate: `${year}-01-13`, balanceAmount: 300 });
  insert(db, { platform: 'Lodgify', propertyId: 2, startDate: `${year}-07-01`, endDate: `${year}-07-05`, balanceAmount: 500 });
  insert(db, { requestOrigin: 'public', attributionChannel: 'social', startDate: `${year}-07-20`, endDate: `${year}-07-22`, balanceAmount: 400 });
  insert(db, { platform: 'Booking', startDate: `${year}-12-28`, endDate: `${year}-12-31`, balanceAmount: 250 });
  insert(db, { platform: 'Airbnb', startDate: `${year + 1}-01-01`, endDate: `${year + 1}-01-03`, balanceAmount: 999 });
}

test('rule 22 — the months of the exercise add up to yearTotal, in calendar order', () => {
  const { db, finance } = freshDb();
  const year = THIS_YEAR - 2;
  seedPastYear(db, year);
  const s = finance.getSummary({ fiscalYear: year });
  assert.equal(s.exerciseMonths.length, 12);
  assert.equal(s.exerciseMonths.map((m) => m.initial).join(''), 'JFMAMJJASOND');
  assert.equal(sum(s.exerciseMonths, 'revenue'), s.yearTotal);
  assert.equal(s.yearTotal, 1450);
  assert.equal(s.exerciseMonths[6].revenue, 900);
  assert.equal(s.exerciseMonths[0].label, `janvier ${year}`);
});

test('rule 22 — a September closing starts the axis in October', () => {
  const { finance } = freshDb({ closingMonth: 9 });
  const { exerciseMonths } = finance.getSummary({ fiscalYear: THIS_YEAR });
  assert.equal(exerciseMonths[0].month, `${THIS_YEAR - 1}-10`);
  assert.equal(exerciseMonths.map((m) => m.initial).join(''), 'ONDJFMAMJJAS');
});

test('rule 22 — a closed exercise is all « passé », a future one all « à venir »', () => {
  const { db, finance } = freshDb();
  seedPastYear(db, THIS_YEAR - 2);
  seedPastYear(db, THIS_YEAR + 2);
  const past = finance.getSummary({ fiscalYear: THIS_YEAR - 2 }).exerciseMonths;
  assert.equal(sum(past, 'upcoming'), 0);
  assert.equal(sum(past, 'past'), 1450);
  const future = finance.getSummary({ fiscalYear: THIS_YEAR + 2 }).exerciseMonths;
  assert.equal(sum(future, 'past'), 0);
  assert.equal(sum(future, 'upcoming'), 1450);
});

test('rule 3 — the logement filter narrows the months too', () => {
  const { db, finance } = freshDb();
  const year = THIS_YEAR - 2;
  seedPastYear(db, year);
  const s = finance.getSummary({ fiscalYear: year, propertyId: 2 });
  assert.equal(sum(s.exerciseMonths, 'revenue'), 500);
  assert.equal(s.yearTotal, 500);
  assert.deepEqual(s.revenueByProperty.map((p) => p.propertyId), [2]);
});
