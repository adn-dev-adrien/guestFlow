// specs/pricing-components.md §3 rules 23, 72 and 75 — REFUNDS / owed: the money that must leave and has not yet, in cents.
const test = require('node:test');
const assert = require('node:assert/strict');
const { owedOnBasket, owedOnLinkPayment, owedOnDuplicate, owedOnLineLowered } = require('../utils/pricing/refunds/owed');

test('rule 75 — a basket the plugin could not honour owes the whole payment, or only the part its owner flagged', () => {
  assert.deepEqual(owedOnBasket({ paidCents: 4200, reason: 'créneau plus libre' }), { owedCents: 4200, reason: 'créneau plus libre' });
  assert.deepEqual(owedOnBasket({ paidCents: 4200, refundCents: 600, reason: 'prix baissé' }), { owedCents: 600, reason: 'prix baissé' });
  assert.equal(owedOnBasket({ paidCents: 4200, refundCents: 4200 }).owedCents, 4200, 'a part equal to the payment is the payment');
  assert.equal(owedOnBasket({ paidCents: 4200, refundCents: 9000 }).owedCents, 4200, 'a part above the payment is ignored');
  assert.equal(owedOnBasket({ paidCents: 4200, refundCents: 0 }).owedCents, 4200);
  assert.equal(owedOnBasket({ paidCents: 4200 }).reason, 'achat non honoré');
});

test('rule 75 — a basket that was honoured, or paid nothing, owes nothing', () => {
  assert.deepEqual(owedOnBasket({ paidCents: 4200, honoured: true }), { owedCents: 0, reason: '' });
  assert.deepEqual(owedOnBasket({ paidCents: 0 }), { owedCents: 0, reason: '' });
});

test('rule 75 — a link paid above what the stay asked owes the excess; a second payment owes the duplicate', () => {
  assert.deepEqual(owedOnLinkPayment({ paidCents: 45536, expectedCents: 35536 }), { excessCents: 10000, duplicateCents: 0 });
  assert.deepEqual(owedOnLinkPayment({ paidCents: 25536, expectedCents: 35536 }), { excessCents: 0, duplicateCents: 0 });
  assert.deepEqual(owedOnLinkPayment({ paidCents: 5000, expectedCents: null, duplicateCents: 5000 }), { excessCents: 0, duplicateCents: 5000 });
  assert.deepEqual(owedOnDuplicate({ paidCents: 8000 }), { owedCents: 8000 });
  assert.deepEqual(owedOnDuplicate({ paidCents: 8000, duplicateCents: 3000 }), { owedCents: 3000 });
});

test('rule 23 — a paid line lowered owes its trop-perçu share, net of what the register already holds for it', () => {
  assert.deepEqual(owedOnLineLowered({ overpaymentCents: 2500 }), { owedCents: 2500 });
  assert.deepEqual(owedOnLineLowered({ overpaymentCents: 2500, alreadyOwedCents: 1000 }), { owedCents: 1500 });
  assert.deepEqual(owedOnLineLowered({ overpaymentCents: 500, alreadyOwedCents: 1000 }), { owedCents: 0 });
});
