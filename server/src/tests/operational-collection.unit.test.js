// specs/dashboard-collection-alert.md §3 + §7 — the dashboard alert must fire ONLY on money to
// collect at the door. The historical bug this pins: a platform booking (no acompte, solde
// transferred after the stay) was red every single day, and a reservation whose complement was
// already collected stayed red because computePaymentStatus ignores the complement buckets.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildOperationalCollection } = require('../utils/operationalCollection');
const { buildCheckoutComplement } = require('../utils/checkoutComplement');

// Mirrors the model wiring: the checkout complement is built first, then handed to the collection.
function build(reservation) {
  const checkout = buildCheckoutComplement(reservation, { amount: Number(reservation.complementAmount || 0), detail: [] });
  return buildOperationalCollection(reservation, checkout);
}

// The reference case: Airbnb pays after the stay → no acompte, the whole rental on the solde.
const PLATFORM_STAY = {
  platform: 'Airbnb', depositAmount: 0, balanceAmount: 400,
  complementAmount: 0, endOfStayComplementAmount: 0,
};

const stateOf = (parts, key) => (parts.find((p) => p.key === key) || {}).state;

test('rule 3 — a platform booking awaiting its payout is NOT an alert', () => {
  const c = build(PLATFORM_STAY);
  assert.equal(c.arrival.alert, false);
  assert.equal(c.departure.alert, false);
  assert.equal(c.platformSettled, true, 'the « Réglé par la plateforme » badge explains the pending solde');
  assert.equal(stateOf(c.arrival.parts, 'balance'), 'pending');
});

test('rule 3 — a DIRECT booking with an unpaid balance is not an alert either', () => {
  const c = build({ platform: 'direct', depositAmount: 150, depositPaid: 1, balanceAmount: 350 });
  assert.equal(c.arrival.alert, false);
  assert.equal(c.platformSettled, false, 'no platform, no badge');
  assert.equal(c.platform, null);
});

test('rule 1 — an unpaid arrival complement IS the alert, with its amount', () => {
  const c = build({ ...PLATFORM_STAY, complementAmount: 45 });
  assert.equal(c.arrival.alert, true);
  assert.equal(c.arrival.amountDue, 45);
  assert.equal(stateOf(c.arrival.parts, 'complement'), 'pending');
});

test('rule 1 — a collected arrival complement clears the alert (the historical bug)', () => {
  assert.equal(build({ ...PLATFORM_STAY, complementAmount: 45, complementPaid: 1 }).arrival.alert, false);
  assert.equal(build({ ...PLATFORM_STAY, complementAmount: 45, complementPaid: 1, complementPaidCash: 1 }).arrival.alert, false);
});

test('rule 2 — a complement deferred to check-out is not an arrival alert', () => {
  const c = build({ ...PLATFORM_STAY, complementAmount: 45, complementDeferredToCheckout: 1 });
  assert.equal(c.arrival.alert, false);
  assert.equal(c.arrival.deferred, true);
  assert.equal(c.arrival.amountDue, 0);
  assert.equal(stateOf(c.arrival.parts, 'complement'), 'deferred');
});

test('rule 6 — the deferred complement becomes the departure alert', () => {
  const c = build({ ...PLATFORM_STAY, complementAmount: 45, complementDeferredToCheckout: 1 });
  assert.equal(c.departure.alert, true);
  assert.equal(c.departure.amountDue, 45);
});

test('rule 6 — an unpaid end-of-stay complement alerts on departure, not on arrival', () => {
  const c = build({ ...PLATFORM_STAY, endOfStayComplementAmount: 60 });
  assert.equal(c.arrival.alert, false);
  assert.equal(c.departure.alert, true);
  assert.equal(c.departure.amountDue, 60);
});

test('rule 6 — the two complement buckets add up at the door', () => {
  const c = build({ ...PLATFORM_STAY, complementAmount: 45, complementDeferredToCheckout: 1, endOfStayComplementAmount: 60 });
  assert.equal(c.departure.amountDue, 105);
  assert.equal(stateOf(c.departure.parts, 'complement'), 'pending');
});

test('rule 6 — an arrival complement never collected still shows at departure', () => {
  const c = build({ ...PLATFORM_STAY, complementAmount: 45 });
  assert.equal(c.departure.alert, true, 'last chance to collect before the guest leaves');
  assert.equal(c.departure.amountDue, 45);
});

test('rule 6 — a settled end-of-stay complement clears the departure alert', () => {
  const c = build({ ...PLATFORM_STAY, complementAmount: 45, complementPaid: 1, endOfStayComplementAmount: 60, endOfStayComplementPaidCash: 1 });
  assert.equal(c.departure.alert, false);
  assert.equal(c.departure.amountDue, 0);
  assert.equal(stateOf(c.departure.parts, 'complement'), 'ok');
});

test('rule 4 — everything settled → green on both sides, no badge', () => {
  const c = build({ ...PLATFORM_STAY, balancePaid: 1, complementAmount: 45, complementPaid: 1 });
  assert.equal(c.arrival.settled, true);
  assert.equal(c.departure.settled, true);
  assert.equal(c.arrival.alert, false);
  assert.equal(c.platformSettled, false, 'nothing left in flight → nothing to explain');
});

test('rule 10 — parts drop the buckets with nothing to collect', () => {
  const c = build(PLATFORM_STAY);
  assert.deepEqual(c.arrival.parts.map((p) => p.key), ['balance'], 'zero deposit and zero complement are omitted');
});

test('rule 10 — a deposit disabled per reservation is omitted, not shown as NON', () => {
  const c = build({ platform: 'direct', depositAmount: 150, depositDisabled: 1, balanceAmount: 350 });
  assert.deepEqual(c.arrival.parts.map((p) => p.key), ['balance']);
});

test('parts order is acompte → solde → complément', () => {
  const c = build({ platform: 'direct', depositAmount: 150, balanceAmount: 350, complementAmount: 45 });
  assert.deepEqual(c.arrival.parts.map((p) => p.key), ['deposit', 'balance', 'complement']);
  assert.deepEqual(c.arrival.parts.map((p) => p.state), ['pending', 'pending', 'pending']);
});

test('the platform badge disappears once every échéance is in', () => {
  const c = build({ ...PLATFORM_STAY, balancePaid: 1, complementAmount: 45 });
  assert.equal(c.platformSettled, false);
  assert.equal(c.arrival.alert, true, 'the door complement still is');
});
