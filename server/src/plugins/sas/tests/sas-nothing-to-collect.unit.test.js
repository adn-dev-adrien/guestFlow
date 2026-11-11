// specs/ui-review-2026-10-19-operations.md rule 4 — « Rien à percevoir » is decided by the server from
// the stored buckets: never over a stay or a complement still owed.
const test = require('node:test');
const assert = require('node:assert/strict');

const { nothingToCollect } = require('../nothingToCollect');
const { bucketStates } = require('../../../utils/reservationSettlement');
const { isDirectChannel } = require('../../../utils/platformNameFormat');

const deps = { bucketStates, isDirectChannel };
const PAID = { platform: 'direct', depositAmount: 100, depositPaid: 1, balanceAmount: 200, balancePaid: 1 };

test('rule 4 — a paid direct stay with no complement: nothing to collect, at both ends', () => {
  assert.equal(nothingToCollect(PAID, deps), true);
  assert.equal(nothingToCollect(PAID, { ...deps, isDeparture: true }), true);
});

test('rule 4 — a stay deferred at check-in is still owed at departure: no badge', () => {
  const deferred = { ...PAID, balancePaid: 0 };
  assert.equal(nothingToCollect(deferred, { ...deps, isDeparture: true }), false);
  assert.equal(nothingToCollect(deferred, deps), false);
});

test('rule 4 — a platform solde is the payout, not door money', () => {
  assert.equal(nothingToCollect({ platform: 'Booking', balanceAmount: 300, balancePaid: 0 }, deps), true);
});

test('rule 4 — an unsettled arrival complement, or a stored end-of-stay one at departure, is owed', () => {
  assert.equal(nothingToCollect({ ...PAID, complementAmount: 40, complementPaid: 0 }, deps), false);
  assert.equal(nothingToCollect({ ...PAID, complementAmount: 40, complementPaidCash: 1 }, deps), true);
  assert.equal(nothingToCollect({ ...PAID, endOfStayComplementAmount: 80 }, { ...deps, isDeparture: true }), false);
  assert.equal(nothingToCollect({ ...PAID, endOfStayComplementAmount: 80 }, deps), true);
});
