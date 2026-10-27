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

test('every bucket paid → remainingDue 0 whatever finalPrice says (the trop-perçu is the refund\'s)', () => {
  const s = computePaymentStatus(
    { finalPrice: 400, depositAmount: 150, balanceAmount: 350, depositPaid: 1, balancePaid: 1 },
    TODAY,
  );
  assert.equal(s.remainingDue, 0);
  assert.equal(s.paymentComplete, true);
});

// Audit 2026-10-27 — remainingDue is the unpaid buckets, not `finalPrice − paid buckets`.
test('the tourist tax rides on the solde: nothing paid → the whole solde, tax included, is due', () => {
  const s = computePaymentStatus({ finalPrice: 380, touristTaxTotal: 6, depositAmount: 0, balanceAmount: 386 }, TODAY);
  assert.equal(s.remainingDue, 386, 'not finalPrice (380)');
});

test('solde paid, a line routed to the arrival complement still owed → the complement is due', () => {
  const s = computePaymentStatus({
    finalPrice: 380, touristTaxTotal: 6, depositAmount: 0, balanceAmount: 306, balancePaid: 1, complementAmount: 80,
  }, TODAY);
  assert.equal(s.remainingDue, 80, 'not 380 − 306 = 74');
  assert.equal(s.paymentComplete, false);
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
