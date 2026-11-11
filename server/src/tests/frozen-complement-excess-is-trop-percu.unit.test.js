// specs/reservation-save-keeps-pricing.md rule 4 — a collected arrival complement stays at what was
// collected, and what it holds above the stay total is a trop-perçu. Money audit 2026-10-28 (finding 5):
// #22209 +0,60 €, #22224 +21 €, #22226 +28 €, #22275 +3,95 € of scheduled money above « Total du séjour »,
// itemised on the fiche as an anonymous « Complément d'arrivée » line the total did not include.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateReservationQuote } = require('../utils/pricing');
const { pricingAuditDb, STAY } = require('./pricingAuditFixture');

// Solde 600 paid, stay raised to 700 and the 100 € complement collected; the stay is then lowered.
const COLLECTED = {
  ...STAY, platform: 'direct', depositPaid: 0, depositAmount: 0, balancePaid: 1, balanceAmount: 600,
  complementPaid: 1, complementAmount: 100,
};

test('rule 4 — a collected complement keeps its amount; what the lowered stay no longer asks is a trop-perçu', () => {
  const q = calculateReservationQuote({ ...COLLECTED, db: pricingAuditDb({ depositPercent: 0 }), customPrice: 650 });
  assert.equal(q.complementAmount, 100, 'the books follow the money collected');
  assert.equal(q.overCollectedTtc, 50);
  const scheduled = q.depositAmount + q.balanceAmount + q.complementAmount;
  assert.equal(scheduled - q.overCollectedTtc, q.finalPrice + q.touristTaxTotal, 'the money scheduled above the total is exactly the trop-perçu');
});

test('rule 4 — a complement that still matches the stay reports nothing', () => {
  const q = calculateReservationQuote({ ...COLLECTED, db: pricingAuditDb({ depositPercent: 0 }), customPrice: 700 });
  assert.equal(q.overCollectedTtc, 0);
});

test('rule 4 — the operator\'s own adjustment of the complement is not second-guessed', () => {
  const q = calculateReservationQuote({
    ...COLLECTED, db: pricingAuditDb({ depositPercent: 0 }), customPrice: 650, complementAmountOverride: 100,
  });
  assert.equal(q.complementAmount, 100);
  assert.equal(q.overCollectedTtc, 0);
});

test('rule 4 — a platform stay reports no trop-perçu from its collected complement (the platform guest is refunded by the platform)', () => {
  const q = calculateReservationQuote({ ...COLLECTED, platform: 'Airbnb', db: pricingAuditDb({ depositPercent: 0 }), customPrice: 650 });
  assert.equal(q.complementAmount, 100);
  assert.equal(q.overCollectedTtc, 0);
});
