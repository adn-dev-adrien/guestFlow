// specs/fiche-total-sejour-net-of-commission.md rule 11 (audit 2026-10-27) — « Total perçu / Vous
// percevez » counts a rise after payment once: the arrival complement owes it, the pre-arrival amount
// must not count it a second time.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateReservationQuote } = require('../utils/pricing');
const { pricingAuditDb, STAY } = require('./pricingAuditFixture');

test('nothing paid: the net is the pre-arrival amount, as before', () => {
  const q = calculateReservationQuote({ ...STAY, db: pricingAuditDb({ depositPercent: 30 }), platform: 'direct' });
  assert.equal(q.finalPrice, 600);
  assert.equal(q.sejourNetTotal, 600);
});

test('solde 600 paid, stay raised to 700: the complement owes 100 and the net is 700 (was 800)', () => {
  const q = calculateReservationQuote({
    ...STAY, db: pricingAuditDb({ depositPercent: 0 }), platform: 'direct',
    customPrice: 700, balancePaid: 1, balanceAmount: 600, depositAmount: 0,
  });
  assert.deepEqual([q.balanceAmount, q.complementAmount], [600, 100]);
  assert.equal(q.sejourNetTotal, 700);
  assert.deepEqual(q.headline, { label: 'Total du séjour', amount: 700, secondary: null });
});

test('acompte 180 + solde 420 paid, stay raised to 700: net 700', () => {
  const q = calculateReservationQuote({
    ...STAY, db: pricingAuditDb({ depositPercent: 30 }), platform: 'direct',
    customPrice: 700, depositPaid: 1, depositAmount: 180, balancePaid: 1, balanceAmount: 420,
  });
  assert.equal(q.complementAmount, 100);
  assert.equal(q.sejourNetTotal, 700);
});

test('a paid stay reduced afterwards keeps the money received in the total (trop-perçu)', () => {
  const q = calculateReservationQuote({
    ...STAY, db: pricingAuditDb({ depositPercent: 30 }), platform: 'direct',
    customPrice: 500, depositPaid: 1, depositAmount: 180, balancePaid: 1, balanceAmount: 420,
  });
  assert.equal(q.overCollectedTtc, 100);
  assert.equal(q.sejourNetTotal, 600);
});

test('platform with acompte, both paid, brut raised to 700: net 700 (was 800)', () => {
  const q = calculateReservationQuote({
    ...STAY, db: pricingAuditDb({ platforms: [{ name: 'GitesDeFrance', collects: 0, remits: 0 }] }), platform: 'GitesDeFrance',
    platformTakesDeposit: 1, platformGrossAmount: 700, depositPaid: 1, depositAmount: 180, balancePaid: 1, balanceAmount: 420,
  });
  assert.equal(q.sejourNetTotal, 700);
});

test('platform commission is still taken off the net', () => {
  const q = calculateReservationQuote({
    ...STAY, db: pricingAuditDb({ platforms: [{ name: 'Booking' }] }), platform: 'Booking',
    platformGrossAmount: 600, platformCommissionAmount: 90,
  });
  assert.equal(q.platformNetReceivedAmount, 510);
  assert.equal(q.sejourNetTotal, 510);
});
