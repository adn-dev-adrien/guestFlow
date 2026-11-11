// specs/single-vat-rate.md rule 13 (audit 2026-10-27) — the live « Total HT / TVA » includes the
// extra-guest supplement in the accommodation base, like the stored summary and the export.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateReservationQuote } = require('../utils/pricing');
const { pricingAuditDb, STAY } = require('./pricingAuditFixture');

test('finalPrice 500 with a 120 € supplement: HT 454,55 + TVA 45,45 = 500', () => {
  const db = pricingAuditDb({ unit: 'per_night', included: 2, extraGuestPrice: 20 });
  db.prepare('UPDATE pricing_rules SET pricePerNight = 100 WHERE id = 1').run();
  const q = calculateReservationQuote({
    ...STAY, db, platform: 'direct', adults: 4, startDate: '2026-05-01', endDate: '2026-05-04',
    selectedOptions: [{ optionId: 10, quantity: 1 }],
  });
  assert.deepEqual([q.finalPrice, q.extraGuestSurcharge], [500, 120]);
  assert.equal(q.totalNetPrice, 454.55);
  assert.equal(q.totalVatAmount, 45.45);
  assert.equal(Math.round((q.totalNetPrice + q.totalVatAmount) * 100) / 100, q.finalPrice);
});
