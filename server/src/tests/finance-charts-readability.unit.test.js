const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rules 43-46 and specs/booking-pace.md rules 14-15 (UI/UX review
// 2026-10-18, proposals 8, 9, 18 and decisions 9-10): « meilleur mois » on months over only, the month
// grammar of « Revenu par mois », the logement colour slots, the short hero curve, the current month
// and the écart row of the pace chart.
const { freshDb, insert, TODAY } = require('./financeDashboardFixture');
const dashboardModel = require('../models/financeDashboardModel');
const { buildInsights } = require('../utils/financeInsights');
const { exerciseMonths } = require('../utils/exerciseOverview');
const pace = require('../utils/bookingPace');
const { labelRevenueMonths, compactAmount } = require('../utils/financeChartLabels');

const norm = (s) => s.replace(/\s/g, ' ');
const late = { count: 0, amount: 0 };
const direct = { revenue: 0, averagePlatformRate: null };
const m = (month, past, upcoming = 0, previous = null) => ({ month, past, upcoming, previous });

test('rule 43 — a best month is a month over; the leading month is named as such before any', () => {
  const { bestMonthOf } = dashboardModel;
  const months = [m('2026-10', 315), m('2026-11', 0), m('2027-08', 0, 805), m('2027-09', 0)];
  // 19 October: no month over yet → August leads the bookings, it is not « the best month ».
  assert.deepEqual(bestMonthOf(months, '2026-10-19'), { month: '2027-08', revenue: 805, previous: null, kind: 'leading', timing: 'upcoming' });
  // 1 November: October is over and carries revenue → best among the months over, with August bigger.
  assert.deepEqual(bestMonthOf(months, '2026-11-01'), { month: '2026-10', revenue: 315, previous: null, kind: 'over' });
  // Every month over → best month of the exercise.
  assert.equal(bestMonthOf(months, '2027-10-01').kind, 'exercise');
  // The current month leading.
  assert.equal(bestMonthOf([m('2026-10', 300, 200), m('2026-11', 0, 100)], '2026-10-05').timing, 'current');
  // Months over without revenue do not make a best month; nothing at all → none.
  assert.equal(bestMonthOf([m('2026-10', 0), m('2026-11', 0, 90)], '2026-11-02').kind, 'leading');
  assert.equal(bestMonthOf([m('2026-10', 0), m('2026-11', 0)], '2026-10-02'), null);
});

test('rule 43 — a tie goes to the earliest month; a month over in the red (refunds) is no best month', () => {
  const { bestMonthOf } = dashboardModel;
  assert.equal(bestMonthOf([m('2026-10', 500), m('2026-11', 500), m('2026-12', 0)], '2027-01-05').month, '2026-10');
  // Only a refund in October, over: not a best month, the leading upcoming month is named instead.
  assert.deepEqual(bestMonthOf([m('2026-10', -120), m('2027-03', 0, 300)], '2026-11-02'), { month: '2027-03', revenue: 300, previous: null, kind: 'leading', timing: 'upcoming' });
  // A negative month over beside a positive one: the positive one.
  assert.equal(bestMonthOf([m('2026-10', -120), m('2026-11', 90), m('2027-03', 0, 300)], '2026-12-02').month, '2026-11');
});

test('rule 44 — the server says which totals are written, on which segment, in compact French', () => {
  const out = labelRevenueMonths([
    { month: '2026-10', revenue: 8226, upcoming: 0 },
    { month: '2026-11', revenue: 805, upcoming: 805 },
    { month: '2026-12', revenue: 400, upcoming: 0 },
    { month: '2027-01', revenue: 0, upcoming: 0 },
    { month: '2027-02', revenue: -50, upcoming: 0 },
  ]);
  assert.deepEqual(out.map((x) => [norm(x.totalLabel), x.labelOn]), [['8,2 k', 'past'], ['805', 'upcoming'], ['', null], ['', null], ['', null]]);
  assert.equal(norm(compactAmount(12000)), '12 k');
});

test('rule 43 — wording of each kind', () => {
  const say = (bestMonth) => buildInsights({ bestMonth, direct, late })[0];
  const lead = say({ month: '2027-08', revenue: 805, previous: null, kind: 'leading', timing: 'upcoming' });
  assert.equal(norm(lead.title), 'Août, en tête des réservations : 805 €');
  assert.equal(lead.text, 'Mois à venir.');
  assert.equal(say({ month: '2026-10', revenue: 500, previous: null, kind: 'leading', timing: 'current' }).text, 'Mois en cours, pas encore terminé.');
  const over = say({ month: '2026-10', revenue: 1315, previous: 900, kind: 'over' });
  assert.equal(over.title, 'Octobre, meilleur mois terminé');
  assert.equal(norm(over.text), "1 315 €, contre 900 € l'an dernier.");
  assert.equal(say({ month: '2026-08', revenue: 8226, previous: null, kind: 'exercise' }).title, "Août, meilleur mois de l'exercice");
});

test('rule 44 — the exercise months carry an unambiguous abbreviation', () => {
  const months = exerciseMonths('2026-10-01', '2027-09-30');
  assert.deepEqual(months.map((x) => x.short), ['oct.', 'nov.', 'déc.', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.']);
  assert.equal(months[3].initial, 'J');
});

// The exercise that starts this month: closing month = the month before the current one.
const startingNow = () => ((Number(TODAY.slice(5, 7)) + 10) % 12) + 1;

test('rules 44-46 — current month, colour slots and the short curve on the dashboard payload', () => {
  const { db, dashboard } = freshDb({ closingMonth: startingNow() });
  insert(db, { startDate: TODAY, endDate: TODAY, balanceAmount: 100, createdAt: `${TODAY} 08:00:00` });
  const d = dashboard.getDashboard({}).data;
  const current = d.revenueMonths.filter((x) => x.isCurrent);
  assert.equal(current.length, 1);
  assert.equal(current[0].month, TODAY.slice(0, 7));
  assert.equal(d.revenueMonths[0].month, TODAY.slice(0, 7));
  assert.ok(d.revenueMonths.every((x) => typeof x.short === 'string'));
  // Rule 45 — a colour slot per logement in id order; the colour itself is a client theme token.
  assert.deepEqual(d.properties.map((p) => p.colorIndex), [0, 1, 2]);
  assert.deepEqual(d.occupancy.map((o) => o.colorIndex), [0, 1, 2]);
  assert.ok(d.properties.every((p) => p.color === undefined));
  // Rule 46 — first month of the exercise not over → the curve stays, compact.
  assert.equal(d.hero.curveCompact, true);
  assert.ok(d.hero.cumulative.length > 0);
  // Last exercise: every month over → full height; a month window never compacts.
  assert.equal(dashboard.getDashboard({ fiscalYear: d.fiscalYear.key - 1 }).data.hero.curveCompact, false);
  assert.equal(dashboard.getDashboard({ period: 'month', month: TODAY.slice(0, 7) }).data.hero.curveCompact, false);
  // An exercise entirely to come: its first month is not over either → compact.
  assert.equal(dashboard.getDashboard({ fiscalYear: d.fiscalYear.key + 1 }).data.hero.curveCompact, true);
  assert.ok(d.revenueMonths.every((x) => 'totalLabel' in x && 'labelOn' in x));
});

test('rules 14-15 — pace: the current month is marked, the écart row waits for a comparison', () => {
  const stay = (o) => ({ propertyId: 1, totalSejour: 0, cancelledOn: null, ...o });
  const without = pace.buildPace({
    stays: [stay({ startDate: '2026-11-02', endDate: '2026-11-04', bookedOn: '2026-09-01' })],
    today: '2026-10-19', metric: 'reservations', coverageMonth: '2026-01',
  });
  assert.deepEqual(without.months.filter((x) => x.isCurrent).map((x) => x.month), ['2026-10']);
  assert.equal(without.hasComparison, false);
  const withLastYear = pace.buildPace({
    stays: [
      stay({ startDate: '2024-10-05', endDate: '2024-10-06', bookedOn: '2024-09-01' }),
      stay({ startDate: '2025-11-02', endDate: '2025-11-04', bookedOn: '2025-09-01' }),
    ],
    today: '2026-10-19', metric: 'reservations', coverageMonth: '2024-10',
  });
  assert.equal(withLastYear.hasComparison, true);
});
