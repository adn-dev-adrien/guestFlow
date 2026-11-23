const test = require('node:test');
const assert = require('node:assert/strict');

// The functions take « today » as an argument; the clock is pinned on the same day so the file reads one calendar.
test.mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-15T12:00:00') });

// specs/mobile-dashboard-exercise-cash.md rule 14 — the dated expected payments of a stay.
const { expectedPayments } = require('../utils/expectedPayments');
const { remainingToPay } = require('../utils/reservationSettlement');

const TODAY = '2026-06-15';
const stay = (over = {}) => ({
  kind: 'reservation', platform: 'direct', requestOrigin: null, createdAt: '2026-05-01 10:00:00',
  startDate: '2026-07-10', endDate: '2026-07-14',
  depositAmount: 0, balanceAmount: 0, complementAmount: 0, endOfStayComplementAmount: 0, ...over,
});
const sum = (lines) => Math.round(lines.reduce((n, l) => n + l.amount, 0) * 100) / 100;
const run = (r, ctx = {}) => expectedPayments(r, { today: TODAY, ...ctx });

test('acompte on its due date, solde on its own', () => {
  const r = stay({ depositAmount: 100, depositDueDate: '2026-06-20', balanceAmount: 400, balanceDueDate: '2026-07-01' });
  assert.deepEqual(run(r).map((l) => [l.kind, l.date, l.amount, l.late]), [
    ['deposit', '2026-06-20', 100, false], ['balance', '2026-07-01', 400, false],
  ]);
});

test('an acompte with no due date is expected the booking day and is « due now », not late', () => {
  const lines = run(stay({ depositAmount: 100 }));
  assert.deepEqual(lines.map((l) => [l.date, l.late, l.dueNow]), [['2026-05-01', false, true]]);
});

test('the booking day is the server-local one, not the UTC slice of createdAt', () => {
  const { localIsoDate } = require('../utils/localDate');
  const stamp = '2026-05-01 23:30:00';
  const [line] = run(stay({ depositAmount: 100, createdAt: stamp }));
  assert.equal(line.date, localIsoDate(new Date('2026-05-01T23:30:00Z')));
});

test('« late » is what the « En retard » tile calls overdue', () => {
  const past = run(stay({ depositAmount: 100, depositDueDate: '2026-06-01', balanceAmount: 300, balanceDueDate: '2026-06-15', complementAmount: 20, startDate: '2026-06-10' }));
  const byKind = Object.fromEntries(past.map((l) => [l.kind, [l.late, l.dueNow]]));
  assert.deepEqual(byKind.deposit, [true, false]);
  assert.deepEqual(byKind.balance, [false, false], 'due today is not late');
  assert.deepEqual(byKind.complement, [false, true], 'a complement has no due date: due now');
  const [payout] = run(stay({ platform: 'Airbnb', balanceAmount: 500, endDate: '2026-06-01' }), { payoutDueDays: 3 });
  assert.deepEqual([payout.date, payout.late], ['2026-06-04', true]);
  const [recent] = run(stay({ installmentsUnpaidAmount: 100, startDate: '2026-08-01' }), { installments: [{ number: 1, count: 2, dueDate: '2026-06-13', amountCents: 10000 }] });
  assert.equal(recent.late, false, 'an installment is late three days after its due date');
  assert.equal(recent.dueNow, true);
});

test('a paid, disabled or caisse-interne bucket is not expected', () => {
  const r = stay({ depositAmount: 100, depositPaid: 1, balanceAmount: 300, balancePaidCash: 1, complementAmount: 20, complementPaid: 1, endOfStayComplementAmount: 5, endOfStayComplementPaidCash: 1 });
  assert.deepEqual(run(r), []);
  assert.deepEqual(run(stay({ depositAmount: 100, depositDisabled: 1 })), []);
});

test('a platform solde is the payout, net of commission and penalty, on departure + payoutDueDays', () => {
  const r = stay({ platform: 'Airbnb', balanceAmount: 500, platformCommissionAmount: 75, platformPenaltyAmount: 25 });
  const [line] = run(r, { payoutDueDays: 3 });
  assert.deepEqual([line.kind, line.label, line.date, line.amount], ['payout', 'Versement Airbnb', '2026-07-17', 400]);
});

test('a website request is a direct solde even on a platform-looking row', () => {
  const [line] = run(stay({ platform: 'Booking', requestOrigin: 'public', balanceAmount: 200, balanceDueDate: '2026-07-01' }));
  assert.deepEqual([line.kind, line.date], ['balance', '2026-07-01']);
});

test('complements: arrival day, end of stay on departure day', () => {
  const lines = run(stay({ complementAmount: 30, endOfStayComplementAmount: 12.5 }));
  assert.deepEqual(lines.map((l) => [l.kind, l.date, l.amount]), [['complement', '2026-07-10', 30], ['endOfStay', '2026-07-14', 12.5]]);
});

test('installments: one line per unpaid échéance, labelled n/N, on its due date', () => {
  const r = stay({ installmentsPaidAmount: 100, installmentsUnpaidAmount: 300 });
  const lines = run(r, { installments: [
    { number: 2, count: 4, dueDate: '2026-06-01', amountCents: 15000 },
    { number: 3, count: 4, dueDate: '2026-07-01', amountCents: 15000 },
  ] });
  assert.deepEqual(lines.map((l) => [l.label, l.date, l.amount, l.late]), [
    ['Échéance 2/4', '2026-06-01', 150, true], ['Échéance 3/4', '2026-07-01', 150, false],
  ]);
});

test('the reste of a split payment is expected on the departure day', () => {
  const [line] = run(stay({ depositAmount: 100, depositPaid: 1, splitShortfallDue: 40 }));
  assert.deepEqual([line.kind, line.date, line.amount], ['split', '2026-07-14', 40]);
});

test('a difference the buckets do not explain is one « Reste à régler » line, never dropped', () => {
  const r = stay({ installmentsUnpaidAmount: 200 });
  const lines = run(r);
  assert.deepEqual(lines.map((l) => [l.kind, l.label, l.date, l.amount]), [['residual', 'Reste à régler', '2026-07-14', 200]]);
  assert.equal(sum(lines), remainingToPay(r));
});

test('a cancelled stay expects nothing from its plan', () => {
  assert.deepEqual(run(stay({ kind: 'cancelled', installmentsUnpaidAmount: 200 }), { installments: [{ number: 1, count: 1, dueDate: '2026-07-01', amountCents: 20000 }] }), []);
});

test('the lines add up to remainingToPay on randomised stays', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const money = () => Math.round(rnd() * 50000) / 100;
  const flag = () => (rnd() < 0.4 ? 1 : 0);
  for (let i = 0; i < 300; i += 1) {
    const platform = rnd() < 0.5 ? 'direct' : 'Booking';
    const unpaidPlan = rnd() < 0.3 ? money() : 0;
    const r = stay({
      platform, depositAmount: money(), depositPaid: flag(), depositPaidCash: flag() && flag(), depositDisabled: flag() && flag(),
      balanceAmount: money(), balancePaid: flag(), balancePaidCash: flag() && flag(),
      complementAmount: money(), complementPaid: flag(), endOfStayComplementAmount: money(), endOfStayComplementPaid: flag(),
      acompteCommissionAmount: platform === 'direct' ? 0 : money() / 10, platformCommissionAmount: platform === 'direct' ? 0 : money() / 10,
      installmentsUnpaidAmount: unpaidPlan, splitShortfallDue: rnd() < 0.2 ? money() / 5 : 0,
    });
    const installments = unpaidPlan ? [{ number: 1, count: 2, dueDate: '2026-08-01', amountCents: Math.round(unpaidPlan * 50) }] : [];
    const lines = run(r, { installments, payoutDueDays: 7 });
    assert.equal(sum(lines), remainingToPay(r), JSON.stringify(r));
    assert.deepEqual([...lines].sort((a, b) => a.date.localeCompare(b.date)).map((l) => l.date), lines.map((l) => l.date));
  }
});
