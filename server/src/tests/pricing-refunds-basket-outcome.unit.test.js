// specs/pricing-components.md §3 rules 72, 75 (SDK 2.29.0) — what a plugin tells the payment poller about a basket it sold or could not honour comes
// from `utils/pricing/refunds/basketOutcome.js`: the whole payment owed back (origin `orderConflict`), the gap a cheaper sale left, the overpayment itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const { notHonoured, partlyOwed, overpaidBy } = require('../utils/pricing/refunds/basketOutcome');

test('rule 75 — a basket the plugin could not honour owes the whole payment back, origin orderConflict', () => {
  assert.deepEqual(notHonoured('créneau pris'), { refundOwed: true, origin: 'orderConflict', reason: 'créneau pris' });
});

test('rule 75 — a sale cheaper than the payment owes the gap back and says so, the effect kept', () => {
  assert.deepEqual(partlyOwed('guest-order-paid', 250, 'moins cher'), {
    effect: 'guest-order-paid', refundOwed: true, origin: 'orderConflict', refundCents: 250, reason: 'moins cher',
  });
});

test('rule 72 — the overpayment is the payment above the sale, never below nothing', () => {
  assert.equal(overpaidBy(1800, 1550), 250);
  assert.equal(overpaidBy(1800, 1800), 0);
  assert.equal(overpaidBy(1000, 1200), 0);
  assert.equal(overpaidBy(undefined, 100), 0);
});
