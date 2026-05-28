const test = require('node:test');
const assert = require('node:assert/strict');

const { computePaymentStatus } = require('../utils/paymentStatus');

const TODAY = '2026-05-28';

test('nothing paid → remainingDue equals finalPrice, not complete', () => {
  const s = computePaymentStatus({ finalPrice: 500, depositAmount: 150, balanceAmount: 350 }, TODAY);
  assert.equal(s.remainingDue, 500);
  assert.equal(s.paymentComplete, false);
});

test('deposit + balance paid → remainingDue 0, complete', () => {
  const s = computePaymentStatus(
    { finalPrice: 500, depositAmount: 150, balanceAmount: 350, depositPaid: 1, balancePaid: 1 },
    TODAY,
  );
  assert.equal(s.remainingDue, 0);
  assert.equal(s.paymentComplete, true);
});

test('deposit only paid → remainingDue is the balance', () => {
  const s = computePaymentStatus(
    { finalPrice: 500, depositAmount: 150, balanceAmount: 350, depositPaid: 1 },
    TODAY,
  );
  assert.equal(s.remainingDue, 350);
  assert.equal(s.paymentComplete, false);
});

test('overpaid → negative remainingDue is still complete', () => {
  const s = computePaymentStatus(
    { finalPrice: 400, depositAmount: 150, balanceAmount: 350, depositPaid: 1, balancePaid: 1 },
    TODAY,
  );
  assert.equal(s.remainingDue, -100);
  assert.equal(s.paymentComplete, true);
});

test('deposit overdue (past due date, unpaid) but balance not yet due', () => {
  const s = computePaymentStatus({
    finalPrice: 500, depositAmount: 150, balanceAmount: 350,
    depositDueDate: '2026-05-01', balanceDueDate: '2026-06-30',
  }, TODAY);
  assert.equal(s.depositOverdue, true);
  assert.equal(s.balanceOverdue, false);
  assert.equal(s.overdueAmount, 150);
  assert.equal(s.isOverdue, true);
  assert.equal(s.oldestDueDate, '2026-05-01');
});

test('both overdue → overdueAmount sums deposit + balance', () => {
  const s = computePaymentStatus({
    finalPrice: 500, depositAmount: 150, balanceAmount: 350,
    depositDueDate: '2026-05-01', balanceDueDate: '2026-05-20',
  }, TODAY);
  assert.equal(s.overdueAmount, 500);
  assert.equal(s.oldestDueDate, '2026-05-01');
});

test('paid items are never overdue', () => {
  const s = computePaymentStatus({
    finalPrice: 500, depositAmount: 150, balanceAmount: 350,
    depositPaid: 1, balancePaid: 1,
    depositDueDate: '2026-05-01', balanceDueDate: '2026-05-20',
  }, TODAY);
  assert.equal(s.isOverdue, false);
  assert.equal(s.overdueAmount, 0);
});

test('no due dates → never overdue, oldestDueDate null', () => {
  const s = computePaymentStatus({ finalPrice: 500, depositAmount: 150, balanceAmount: 350 }, TODAY);
  assert.equal(s.isOverdue, false);
  assert.equal(s.oldestDueDate, null);
});
