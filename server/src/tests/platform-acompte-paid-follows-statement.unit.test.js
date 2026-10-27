// specs/reservation-refunds.md rule 40 (audit 2026-10-27) — rule 38 holds on a platform that takes an
// acompte: both paid, the acompte stays and the paid solde follows the statement; no complement.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateReservationQuote } = require('../utils/pricing');
const { pricingAuditDb, STAY } = require('./pricingAuditFixture');

const GDF = { platform: 'GitesDeFrance', platformTakesDeposit: 1, depositPaid: 1, depositAmount: 180, balancePaid: 1, balanceAmount: 420 };
const db = () => pricingAuditDb({ platforms: [{ name: 'GitesDeFrance', collects: 0, remits: 0 }] });

test('brut corrected down to 450: acompte 180, solde 270, nothing over-collected', () => {
  const q = calculateReservationQuote({ ...STAY, db: db(), ...GDF, platformGrossAmount: 450 });
  assert.deepEqual([q.depositAmount, q.balanceAmount, q.complementAmount, q.overCollectedTtc], [180, 270, 0, 0]);
  assert.equal(q.sejourNetTotal, 450);
});

test('brut corrected up to 700: solde 520, no 100 € complement asked at arrival', () => {
  const q = calculateReservationQuote({ ...STAY, db: db(), ...GDF, platformGrossAmount: 700 });
  assert.deepEqual([q.depositAmount, q.balanceAmount, q.complementAmount], [180, 520, 0]);
});

test('a direct stay keeps its paid buckets and asks the rise as a complement (unchanged)', () => {
  const q = calculateReservationQuote({
    ...STAY, db: db(), platform: 'direct', customPrice: 700,
    depositPaid: 1, depositAmount: 180, balancePaid: 1, balanceAmount: 420,
  });
  assert.deepEqual([q.depositAmount, q.balanceAmount, q.complementAmount], [180, 420, 100]);
});
