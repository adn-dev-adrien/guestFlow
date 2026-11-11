// specs/pricing-components.md §3 rules 70 and 6 — PLATFORM PAYMENT alone: the commission from a statement or from the
// rent, each commission clamped to its instalment, the net received, the gross / acompte-net / payout / cancellation
// helpers. No DB, plain objects.
const test = require('node:test');
const assert = require('node:assert/strict');
const platformPayment = require('../utils/pricing/platformPayment');
const legacy = require('../utils/platformCommission');

const {
  commissionOf, clampCommissions, netReceived, acompteNet, grossOf, payoutWithPenalty, withheldOnCancellation,
} = platformPayment;

test('rule 70 — commissionOf(statement) = max(0, gross − payout − withheld tax − acompte commission), null when a figure is missing', () => {
  assert.equal(commissionOf({ basis: 'statement', gross: 500, payout: 420, withheldTax: 20, acompteCommission: 10 }), 50);
  assert.equal(commissionOf({ gross: 500, payout: 600 }), 0);
  assert.equal(commissionOf({ gross: 100.1, payout: 60.05 }), 40.05);
  assert.equal(commissionOf({ gross: '', payout: 10 }), null);
  assert.equal(commissionOf({ gross: 10, payout: null }), null);
  assert.equal(commissionOf({ gross: 'abc', payout: 1 }), null);
  assert.equal(commissionOf({ gross: 500, payout: 420, withheldTax: -30 }), 80, 'a negative withheld tax counts as 0');
});

test('rule 70 — the old module re-exports the same computePlatformCommission', () => {
  assert.equal(legacy.computePlatformCommission, platformPayment.computePlatformCommission);
});

test('rule 70 — commissionOf(rentOnly) = rent − net rent to the cent, null when a figure is missing', () => {
  assert.equal(commissionOf({ basis: 'rentOnly', rent: 400, netRent: 340.5 }), 59.5);
  assert.equal(commissionOf({ basis: 'rentOnly', rent: 100, netRent: 100.1 }), -0.1);
  assert.equal(commissionOf({ basis: 'rentOnly', rent: 400 }), null);
  assert.equal(commissionOf({ basis: 'rentOnly', netRent: '' , rent: 1 }), null);
});

const named = { namedChannel: true };
const base = { channel: named, installmentPlan: null, preArrivalAmount: 600, balanceAmount: 400, depositAmount: 200 };

test('rule 70 — clampCommissions clamps each commission to its own instalment', () => {
  assert.deepEqual(clampCommissions({ ...base, solde: 50, acompte: 20 }), { solde: 50, acompte: 20, total: 70 });
  assert.deepEqual(clampCommissions({ ...base, solde: 900, acompte: 100 }), { solde: 400, acompte: 100, total: 500 });
  assert.deepEqual(clampCommissions({ ...base, depositAmount: 0, solde: 10, acompte: 100 }), { solde: 10, acompte: 0, total: 10 });
});

test('rule 70 — clampCommissions: an installment plan caps the solde at the whole pre-arrival amount', () => {
  const planned = { ...base, installmentPlan: { count: 2 }, balanceAmount: 0, depositAmount: 0 };
  assert.deepEqual(clampCommissions({ ...planned, solde: 90, acompte: 0 }), { solde: 90, acompte: 0, total: 90 });
  assert.equal(clampCommissions({ ...planned, solde: 9000, acompte: 0 }).solde, 600);
});

test('rule 70 — clampCommissions: a direct channel, a blank, a negative or a non-number carry no commission', () => {
  const direct = { ...base, channel: { namedChannel: false } };
  assert.deepEqual(clampCommissions({ ...direct, solde: 50, acompte: 20 }), { solde: 0, acompte: 0, total: 0 });
  assert.deepEqual(clampCommissions({ ...base, solde: '', acompte: null }), { solde: 0, acompte: 0, total: 0 });
  assert.deepEqual(clampCommissions({ ...base, solde: -5, acompte: 'x' }), { solde: 0, acompte: 0, total: 0 });
  assert.equal(clampCommissions({ ...base, solde: 10.005, acompte: 0.004 }).total, 10.01);
});

test('rule 70 — netReceived = pre-arrival amount − commissions, null without commission', () => {
  assert.equal(netReceived({ preArrivalAmount: 600, totalPlatformCommission: 70 }), 530);
  assert.equal(netReceived({ preArrivalAmount: 600.1, totalPlatformCommission: 0.2 }), 599.9);
  assert.equal(netReceived({ preArrivalAmount: 600, totalPlatformCommission: 0 }), null);
});

test('rule 70 — acompteNet and grossOf', () => {
  assert.equal(acompteNet({ depositAmount: 200, acompteCommissionAmount: 30 }), 170);
  assert.equal(acompteNet({ depositAmount: 20, acompteCommissionAmount: 30 }), 0);
  assert.equal(acompteNet({ depositAmount: 200, depositDisabled: 1 }), 0);
  assert.equal(acompteNet({ depositAmount: 0 }), 0);
  assert.equal(grossOf({ platformGrossAmount: 640.5, depositAmount: 1, balanceAmount: 1 }), 640.5);
  assert.equal(grossOf({ platformGrossAmount: '', depositAmount: 200.1, balanceAmount: 400.2 }), 600.3);
  assert.equal(grossOf({ platformGrossAmount: null, depositAmount: 0, balanceAmount: null }), 0);
});

test('rule 70 — payoutWithPenalty adds a positive penalty only', () => {
  assert.equal(payoutWithPenalty({ payout: 500.1, penalty: 20.2 }), 520.3);
  assert.equal(payoutWithPenalty({ payout: 500, penalty: -20 }), 500);
  assert.equal(payoutWithPenalty({ payout: 500 }), 500);
});

test('rule 70 — withheldOnCancellation counts only the commissions of buckets paid to the books', () => {
  assert.deepEqual(withheldOnCancellation({ depositPaid: 1, balancePaid: 1, acompteCommissionAmount: 12.5, platformCommissionAmount: 40 }), { acompte: 12.5, solde: 40 });
  assert.deepEqual(withheldOnCancellation({ depositPaid: 1, depositPaidCash: 1, balancePaid: 0, acompteCommissionAmount: 12.5, platformCommissionAmount: 40 }), { acompte: 0, solde: 0 });
  assert.deepEqual(withheldOnCancellation({ depositPaid: 0, balancePaid: 1, platformCommissionAmount: -3 }), { acompte: 0, solde: 0 });
});
