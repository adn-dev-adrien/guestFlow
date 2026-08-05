// specs/dashboard-collection-alert.md §4.1 — `isSettled` / `remainingToPay` were extracted from
// financeModel.js so the dashboard's collection status shares the exact same bucket rules. These
// cases pin the extracted behavior (the finance suite covers the same rules end-to-end through
// getSummary / getOperational, this one covers the pure functions directly).

const test = require('node:test');
const assert = require('node:assert/strict');

const { bucketStates, isSettled, remainingToPay, platformCommission } = require('../utils/reservationSettlement');

const PLATFORM_STAY = {
  depositAmount: 0, balanceAmount: 400, complementAmount: 60, endOfStayComplementAmount: 0,
};

test('bucketStates: a zero-amount bucket is not applicable', () => {
  const b = bucketStates(PLATFORM_STAY);
  assert.equal(b.deposit.applicable, false);
  assert.equal(b.balance.applicable, true);
  assert.equal(b.complement.applicable, true);
  assert.equal(b.endOfStay.applicable, false);
});

test('bucketStates: a deposit disabled per reservation is not applicable either', () => {
  const b = bucketStates({ depositAmount: 150, depositDisabled: 1 });
  assert.equal(b.deposit.applicable, false);
});

test('bucketStates: caisse interne settles a complement', () => {
  const b = bucketStates({ complementAmount: 60, complementPaidCash: 1, endOfStayComplementAmount: 40, endOfStayComplementPaidCash: 1 });
  assert.equal(b.complement.settled, true);
  assert.equal(b.endOfStay.settled, true);
});

test('isSettled: false while any applicable bucket is unpaid', () => {
  assert.equal(isSettled(PLATFORM_STAY), false);
  assert.equal(isSettled({ ...PLATFORM_STAY, balancePaid: 1 }), false, 'the complement is still owed');
  assert.equal(isSettled({ ...PLATFORM_STAY, balancePaid: 1, complementPaid: 1 }), true);
});

test('isSettled: a disabled deposit and a caisse-interne complement count as settled', () => {
  assert.equal(isSettled({
    depositAmount: 100, depositDisabled: 1,
    balanceAmount: 200, balancePaid: 1,
    complementAmount: 60, complementPaidCash: 1,
  }), true);
});

test('isSettled: a reservation with nothing to collect is settled', () => {
  assert.equal(isSettled({}), true);
});

test('remainingToPay: sums only the unpaid buckets, complements included', () => {
  assert.equal(remainingToPay({
    depositAmount: 100, depositPaid: 1,
    balanceAmount: 200, balancePaid: 1,
    complementAmount: 60, endOfStayComplementAmount: 40,
  }), 100, 'only the two unpaid complements remain');
});

test('remainingToPay: nets the per-échéance platform commission of each unpaid bucket', () => {
  assert.equal(remainingToPay({
    depositAmount: 100, acompteCommissionAmount: 10,
    balanceAmount: 200, platformCommissionAmount: 30,
  }), 260);
});

test('remainingToPay: 0 exactly when isSettled is true', () => {
  const settledStay = {
    depositAmount: 100, depositDisabled: 1,
    balanceAmount: 200, balancePaid: 1,
    complementAmount: 60, complementPaidCash: 1,
    endOfStayComplementAmount: 40, endOfStayComplementPaid: 1,
  };
  assert.equal(isSettled(settledStay), true);
  assert.equal(remainingToPay(settledStay), 0);
});

test('platformCommission: acompte + solde, 0 on a direct booking', () => {
  assert.equal(platformCommission({ acompteCommissionAmount: 12.5, platformCommissionAmount: 30 }), 42.5);
  assert.equal(platformCommission({}), 0);
});
