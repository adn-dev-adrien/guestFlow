const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveComplementPayment } = require('../utils/complementPayment');

// specs/cash-complement-and-endofstay-finance.md §3.2 — « caisse interne » payment resolver.
const TODAY = '2026-06-14';

test('cash (caisse interne) implies paid + sets today when no date', () => {
  const r = resolveComplementPayment({ cashInput: true, today: TODAY });
  assert.deepEqual(r, { paid: 1, cash: 1, date: TODAY });
});

test('marking unpaid clears the cash flag', () => {
  const r = resolveComplementPayment({ paidInput: false, prevPaid: 1, prevCash: 1, prevDate: '2026-06-01', today: TODAY });
  assert.deepEqual(r, { paid: 0, cash: 0, date: null });
});

test('flipping an already-paid (compta) complement to caisse interne keeps the existing paid date', () => {
  const r = resolveComplementPayment({ cashInput: true, prevPaid: 1, prevCash: 0, prevDate: '2026-05-20', today: TODAY });
  assert.deepEqual(r, { paid: 1, cash: 1, date: '2026-05-20' });
});

test('normal compta payment: cash stays 0, today when no date', () => {
  const r = resolveComplementPayment({ paidInput: true, today: TODAY });
  assert.deepEqual(r, { paid: 1, cash: 0, date: TODAY });
});

test('turning caisse interne OFF (cash=false) on a paid complement keeps it paid (compta), date preserved', () => {
  const r = resolveComplementPayment({ cashInput: false, prevPaid: 1, prevCash: 1, prevDate: '2026-05-20', today: TODAY });
  assert.deepEqual(r, { paid: 1, cash: 0, date: '2026-05-20' });
});

test('explicit date wins over the previous one', () => {
  const r = resolveComplementPayment({ paidInput: true, dateInput: '2026-07-01', prevDate: '2026-05-20', today: TODAY });
  assert.equal(r.date, '2026-07-01');
});
