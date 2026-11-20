// specs/pricing-components.md §3 rules 72 and 75 — the shapes the payment poll hands the register, the notifier and the alert are built by
// `refunds/owed.js`: the same keys, in the same order, as the literals the poller wrote inline.
const test = require('node:test');
const assert = require('node:assert/strict');
const owed = require('../utils/pricing/refunds/owed');

test('rule 72 — a second paid link: the part to give back, null for the whole link', () => {
  assert.deepEqual(owed.duplicatePayment(), { duplicateCents: null });
  assert.deepEqual(owed.duplicatePayment(0), { duplicateCents: 0 });
  assert.deepEqual(owed.duplicatePayment(4200), { duplicateCents: 4200 });
  assert.equal(owed.owedOnDuplicate({ paidCents: 9000, ...owed.duplicatePayment(null) }).owedCents, 9000);
  assert.equal(owed.owedOnDuplicate({ paidCents: 9000, ...owed.duplicatePayment(4200) }).owedCents, 4200);
});

test('rule 72 — the double-payment effect keeps the keys and their order', () => {
  const effect = owed.doublePaymentEffect(1500, { reservationId: 7, conflict: false });
  assert.deepEqual(effect, { effect: 'double-payment', duplicateLink: true, duplicateCents: 1500, reservationId: 7, conflict: false });
  assert.deepEqual(Object.keys(effect), ['effect', 'duplicateLink', 'duplicateCents', 'reservationId', 'conflict']);
  assert.deepEqual(owed.doublePaymentEffect(null), { effect: 'double-payment', duplicateLink: true, duplicateCents: null });
  assert.deepEqual(owed.doublePaymentEffect(null, { reservationId: undefined }), { effect: 'double-payment', duplicateLink: true, duplicateCents: null, reservationId: undefined });
});

test('rule 72 — the duplicate of a full link after an acompte, and of a full link beyond the solde', () => {
  assert.equal(owed.fullOverDeposit({ depositCents: 3000, linkCents: 9000 }), 3000);
  assert.equal(owed.fullOverDeposit({ depositCents: 12000, linkCents: 9000 }), 9000);
  assert.equal(owed.fullOverDeposit({ depositCents: null, linkCents: 9000 }), 0);
  assert.equal(owed.duplicateOnSolde({ linkCents: 9000, balanceCents: 6000 }), 3000);
  assert.equal(owed.duplicateOnSolde({ linkCents: 5000, balanceCents: 6000 }), 0);
});

test('rule 75 — a basket its plugin could not honour is flagged, with the part when it is only a part', () => {
  assert.deepEqual(owed.flagRefundOwed({ lines: [1] }, null), { lines: [1], refundOwed: true });
  assert.deepEqual(owed.flagRefundOwed({ lines: [1] }, 1200), { lines: [1], refundOwed: true, refundCents: 1200 });
});

test('rule 72 — the excess of a link paid above the stay is the payment less what the stay asked, never negative', () => {
  assert.equal(owed.owedOnLinkPayment({ paidCents: 12000, expectedCents: 10000 }).excessCents, 2000);
  assert.equal(owed.owedOnLinkPayment({ paidCents: 8000, expectedCents: 10000 }).excessCents, 0);
});
