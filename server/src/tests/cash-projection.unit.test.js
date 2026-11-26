const test = require('node:test');
const assert = require('node:assert/strict');

// The functions take « today » as an argument; the clock is pinned on the same day so the file reads one calendar.
test.mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-15T12:00:00') });

// specs/planning/mobile-dashboard-exercise-cash.md rule 18 — the series behind « Trésorerie de l'exercice ».
const { buildCashProjection } = require('../utils/cashProjection');

const exercise = { from: '2026-01-01', to: '2026-12-31' };
const build = (over = {}) => buildCashProjection({
  received: [], expected: [], exercise, window: exercise, today: '2026-06-15', ...over,
});
const month = (p, key) => p.months.find((m) => m.key === key);

test('splits the months into received and expected, the current month on both sides', () => {
  const p = build({
    received: [{ date: '2026-02-10', amount: 100 }, { date: '2026-06-02', amount: 50 }],
    expected: [{ date: '2026-06-20', amount: 70 }, { date: '2026-09-05', amount: 200 }],
  });
  assert.equal(p.months.length, 12);
  assert.deepEqual([month(p, '2026-02').received, month(p, '2026-02').expected], [100, 0]);
  assert.deepEqual([month(p, '2026-06').received, month(p, '2026-06').expected], [50, 70]);
  assert.deepEqual([month(p, '2026-09').received, month(p, '2026-09').expected], [0, 200]);
  assert.equal(p.todayMonth, '2026-06');
});

test('the cumulative ends on the sum of received and expected', () => {
  const p = build({ received: [{ date: '2026-02-10', amount: 100.1 }], expected: [{ date: '2026-09-05', amount: 200.2 }] });
  assert.equal(p.total, 300.3);
  assert.equal(p.daily[p.daily.length - 1].cumulative, 300.3);
  assert.equal(month(p, '2026-12').cumulative, 300.3);
  assert.equal(month(p, '2026-02').cumulative, 100.1);
});

test('the solid line stops on today and the dashed one starts there', () => {
  const p = build({ received: [{ date: '2026-02-10', amount: 100 }], expected: [{ date: '2026-09-05', amount: 200 }] });
  const today = p.daily.find((d) => d.date === '2026-06-15');
  assert.deepEqual([today.solid, today.dashed], [100, 100]);
  assert.equal(p.daily.find((d) => d.date === '2026-09-05').solid, null);
  assert.equal(p.daily.find((d) => d.date === '2026-02-10').dashed, null);
  assert.equal(p.daily[0].date, '2026-01-01');
});

test('an expected payment already late is counted on today', () => {
  const p = build({ expected: [{ date: '2026-03-01', amount: 480, late: true }] });
  assert.equal(p.lateAmount, 480);
  const point = p.daily.find((d) => d.date === '2026-06-15');
  assert.deepEqual([point.expected, point.dashed, point.solid], [480, 480, 0]);
  assert.equal(month(p, '2026-06').expected, 480);
});

test('what lands after the exercise ends goes in the « après » column', () => {
  const p = build({ expected: [{ date: '2027-01-08', amount: 640 }] });
  const after = month(p, 'after');
  assert.deepEqual([after.label, after.expected, after.inWindow], ['après', 640, true]);
  assert.equal(p.total, 640);
  assert.ok(p.xMax > p.months[11].x);
});

test('no « après » column when nothing lands after the end', () => {
  assert.equal(month(build({ expected: [{ date: '2026-12-30', amount: 10 }] }), 'after'), undefined);
});

test('a payment received before the exercise counts on its first day, never in the future', () => {
  const p = build({ received: [{ date: '2025-11-30', amount: 90 }, { date: '2026-08-01', amount: 10 }] });
  assert.equal(month(p, '2026-01').received, 90);
  assert.equal(month(p, '2026-06').received, 10);
});

test('months outside a narrower window are flagged', () => {
  const p = build({ window: { from: '2026-03-01', to: '2026-03-31' }, received: [{ date: '2026-03-02', amount: 5 }] });
  assert.deepEqual(p.months.filter((m) => m.inWindow).map((m) => m.key), ['2026-03']);
});

test('a past exercise fully collected is all solid', () => {
  const p = build({ today: '2027-03-01', received: [{ date: '2026-05-05', amount: 300 }] });
  assert.equal(p.lateAmount, 0);
  assert.equal(p.todayMonth, null, 'the marker is not drawn outside the exercise');
  assert.ok(p.daily.filter((d) => d.date < '2026-12-31').every((d) => d.dashed === null));
  assert.equal(p.total, 300);
});

test('a refund lowers the cumulative on its date', () => {
  const p = build({ received: [{ date: '2026-02-01', amount: 100 }, { date: '2026-03-01', amount: -40 }] });
  assert.equal(p.daily.find((d) => d.date === '2026-03-01').cumulative, 60);
});

test('an exercise with no payment is empty', () => {
  const p = build();
  assert.equal(p.empty, true);
  assert.equal(p.total, 0);
});

test('the daily points carry a French label and a day offset from the exercise start', () => {
  const p = build({ received: [{ date: '2026-02-10', amount: 100 }] });
  const point = p.daily.find((d) => d.date === '2026-02-10');
  assert.deepEqual([point.label, point.x], ['10 févr. 2026', 40]);
  assert.equal(p.daily.find((d) => d.date === '2026-02-10').expectedCumulative, 0);
});

test('each month carries its late part, its on-time part and its last day', () => {
  const p = build({ expected: [{ date: '2026-03-01', amount: 480, late: true }, { date: '2026-06-20', amount: 70 }] });
  const june = month(p, '2026-06');
  assert.deepEqual([june.expected, june.late, june.upcoming, june.end], [550, 480, 70, '2026-06-30']);
  assert.equal(month(p, '2026-02').end, '2026-02-28');
  assert.equal(month(p, '2026-12').end, '2026-12-31');
});

test('a due-now payment (past date, not late) is counted on today but is not late', () => {
  const p = build({ expected: [{ date: '2026-05-01', amount: 100, dueNow: true }] });
  assert.equal(p.lateAmount, 0);
  assert.equal(p.daily.find((d) => d.date === '2026-06-15').expected, 100);
});

test('a past exercise with money still owed counts it on its last day, inside the plot, and answers it at the end', () => {
  const p = build({
    today: '2027-03-01',
    received: [{ date: '2026-05-05', amount: 300 }],
    expected: [{ date: '2026-09-01', amount: 200, late: true }],
  });
  assert.equal(p.months.find((m) => m.key === 'after'), undefined);
  const last = p.daily[p.daily.length - 1];
  assert.deepEqual([last.date, last.cumulative, last.expectedCumulative], ['2026-12-31', 500, 200]);
  assert.equal(p.end, '2026-12-31');
  assert.equal(p.total, 500);
  assert.equal(p.lateAmount, 200);
  assert.equal(month(p, '2026-12').late, 200);
  const pivot = p.daily.find((d) => d.date === '2026-12-31');
  assert.deepEqual([pivot.solid, pivot.dashed], [300, 500]);
  assert.equal(p.daily.find((d) => d.date === '2026-05-05').dashed, null);
});

test('the default cursor ends on the last payment, « après » included', () => {
  const p = build({ expected: [{ date: '2027-01-08', amount: 640 }] });
  assert.equal(p.end, '2027-01-08');
  assert.equal(p.endCaption, `Une fois toutes les échéances reçues (${p.endLabel})`);
  assert.equal(build().endCaption, 'À la fin de l\'exercice');
});
