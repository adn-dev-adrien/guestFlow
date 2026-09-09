// specs/collect-stay-payment-at-check-in.md rule 6 (revised 2026-09-08) — the « Séjour à régler »
// step of the arrival SAS exists for the DIRECT channel only. A platform booking's unpaid solde is
// the OTA's payout, wired after the stay: it is never claimed at the door, however the guest's
// complements still are. Found in production on two Booking arrivals whose recap read « Séjour :
// 146,93 € » / « 1 157,58 € » as if the operator had to collect the platform's own money.

const test = require('node:test');
const assert = require('node:assert/strict');

const { __test: { buildStayPayment } } = require('../controllers/sasController');

const ctx = { isDeparture: false, receptionOnly: false };

test('a platform booking with an unpaid solde gets NO stay step', () => {
  const stay = buildStayPayment({ platform: 'Booking', depositAmount: 0, balanceAmount: 146.93, balancePaid: 0 }, ctx);
  assert.equal(stay.applicable, false);
});

test('a direct booking with an unpaid solde keeps the step — the founding last-minute case', () => {
  for (const platform of ['direct', 'Lodgify', undefined]) {
    const stay = buildStayPayment({ platform, depositAmount: 0, balanceAmount: 480, balancePaid: 0 }, ctx);
    assert.equal(stay.applicable, true, `platform=${platform}`);
    assert.equal(stay.total, 480);
  }
});

// rule 14 — what THIS SAS settled must stay visible and undoable, whatever the channel: it is the
// repair path for a platform stay mistakenly collected before the channel restriction shipped.
test('a platform SAS that settled the stay itself still gets the step, to undo it', () => {
  const stay = buildStayPayment({
    platform: 'Booking', depositAmount: 0,
    balanceAmount: 146.93, balancePaid: 1, balancePaidAtArrival: 1, balancePaidCash: 0,
  }, ctx);
  assert.equal(stay.applicable, true);
  assert.equal(stay.paid, true);
  assert.equal(stay.balance.collectible, 146.93);
});

test('a platform booking fully paid elsewhere stays out of the step, like before', () => {
  const stay = buildStayPayment({ platform: 'Airbnb', depositAmount: 0, balanceAmount: 900, balancePaid: 1 }, ctx);
  assert.equal(stay.applicable, false);
});
