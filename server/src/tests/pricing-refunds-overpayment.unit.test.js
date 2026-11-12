// specs/pricing-components.md §3 rules 72 and 76 — REFUNDS / overpayment: the trop-perçu of a stay (one formula for every stay:
// Σ allocations − the stay's total − the free lines of origin `overpayment` given back, owner O-6 and O-7), and its split by
// poste. The legacy module re-exports the unit. Plain objects, no DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const overpaymentUnit = require('../utils/pricing/refunds/overpayment');
const legacy = require('../utils/overpayment');

const { overpayment, overpaymentLinesOf, currentByPoste } = overpaymentUnit;

const ROW = { platform: 'direct', depositPaid: 1, depositAmount: 100, balancePaid: 1, balanceAmount: 200 };
const ctx = (over = {}) => ({ platform: 'direct', paymentsCents: 35000, totalCents: 29000, overpaymentRefundedCents: 0, ...over });

test('rule 72 — the legacy module is the unit', () => {
  assert.equal(legacy, overpaymentUnit);
});

test('rule 76 — collected beyond the stay\'s total, in cents; nothing when the stay is not over-collected', () => {
  assert.deepEqual(overpayment(ctx()), { cents: 6000, unclampedCents: 6000 });
  assert.deepEqual(overpayment(ctx({ paymentsCents: 20000 })), { cents: 0, unclampedCents: -9000 });
});

test('specs/reservation-refunds.md rule 38 — a platform stay has no trop-perçu to give back, whatever was collected', () => {
  assert.deepEqual(overpayment(ctx({ platform: 'Booking.com', paymentsCents: 99900 })), { cents: 0, unclampedCents: 0 });
});

test('rule 76 (O-6) — only the free lines of origin `overpayment` given back lower it; the caller reads them, a gesture is not among them', () => {
  assert.equal(overpayment(ctx({ overpaymentRefundedCents: 500 })).cents, 5500);
  assert.equal(overpayment(ctx({ overpaymentRefundedCents: 6000 })).cents, 0);
  assert.equal(overpayment(ctx({ overpaymentRefundedCents: 9000 })).cents, 0);
});

test('rule 76 — the paid complement the operator adjusted is left out of both sides; the departure\'s own sales are not part of the price', () => {
  assert.equal(overpayment(ctx({ paymentsCents: 41000, adjustedComplementCents: 6000, autoComplementCents: 4000, totalCents: 33000 })).cents, 6000);
  assert.equal(overpayment(ctx({ paymentsCents: 34200, departureOwnCents: 3000, totalCents: 28476 })).cents, 2724);
});

test('rule 76 — the posted fiche: the stored total less the engine drift, never below nothing', () => {
  assert.equal(overpayment(ctx({ engineDriftCents: 4000 }), { basis: 'asSaved' }).cents, 10000);
  assert.equal(overpayment(ctx({ engineDriftCents: -4000 }), { basis: 'asSaved' }).cents, 2000);
  assert.equal(overpayment(ctx({ paymentsCents: 0, totalCents: 0, engineDriftCents: 89800 }), { basis: 'asSaved' }).cents, 0, 'a stay at 0 € that the engine prices higher holds no excess');
  assert.equal(overpayment(ctx({ engineDriftCents: 4000 })).cents, 6000, 'the stored basis ignores the drift');
});

test('rule 72 — the postes of a stay: the accommodation is what the sale holds once the options and activities are out', () => {
  assert.deepEqual(currentByPoste({ finalPrice: 480, touristTaxTotal: 13.2, optionsTotal: 72, resourcesTotal: 28 }), {
    accommodation: 380, options: 72, resources: 28, touristTax: 13.2,
  });
  assert.deepEqual(currentByPoste({}), { accommodation: 0, options: 0, resources: 0, touristTax: 0 });
});

test('rule 72 — the trop-perçu is split by poste, none when there is none', () => {
  const quote = { finalPrice: 380, touristTaxTotal: 12, optionsTotal: 72, resourcesTotal: 0, depositAmount: 100, balanceAmount: 200 };
  const row = { ...ROW, balanceAmount: 300 };
  const lines = overpaymentLinesOf({
    row, capturedByPoste: { accommodation: 300, options: 72, resources: 0, touristTax: 12 }, quote, overpaymentTtc: 100,
  });
  assert.deepEqual(lines, [{
    bucket: 'accommodation', label: 'Hébergement', amountTtc: 100, collectedTtc: 100, dueTtc: 0, excessOnly: true,
  }]);
  assert.deepEqual(overpaymentLinesOf({ row, quote, overpaymentTtc: 0 }), []);
});
