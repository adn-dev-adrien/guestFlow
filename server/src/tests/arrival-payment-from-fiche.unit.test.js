// Recording the single arrival payment from the FICHE — specs/single-payment-from-the-fiche.md.
//
// Two pure pieces, tested here on their own: which buckets are still collectible, and whether the
// operator's collection date is acceptable. Both are shared by the payload and the write, so the
// fiche can never offer something the server would refuse.
const test = require('node:test');
const assert = require('node:assert/strict');

const { collectibleArrivalBuckets } = require('../utils/arrivalPaymentGroup');
const { validateArrivalPaymentDate } = require('../utils/arrivalPaymentDate');

// ── collectibleArrivalBuckets ───────────────────────────────────────────────────────────────────

test('an unpaid stay and an unpaid complement are both collectible', () => {
  assert.deepEqual(
    collectibleArrivalBuckets({
      depositAmount: 0, balanceAmount: 720.82, complementAmount: 132,
    }),
    [
      { bucket: 'balance', label: 'solde', amount: 720.82 },
      { bucket: 'complement', label: 'complément', amount: 132 },
    ],
  );
});

test('a bucket already paid is left alone — the payment it belonged to is not this one', () => {
  const out = collectibleArrivalBuckets({
    depositAmount: 200, depositPaid: 1, balanceAmount: 300, complementAmount: 50,
  });
  assert.deepEqual(out.map((b) => b.bucket), ['balance', 'complement']);
});

test('a disabled acompte is not applicable, whatever its stored amount', () => {
  const out = collectibleArrivalBuckets({
    depositAmount: 200, depositDisabled: 1, balanceAmount: 300, complementAmount: 50,
  });
  assert.deepEqual(out.map((b) => b.bucket), ['balance', 'complement']);
});

test('a 0 € complement is nothing to collect', () => {
  const out = collectibleArrivalBuckets({ balanceAmount: 300, complementAmount: 0 });
  assert.deepEqual(out.map((b) => b.bucket), ['balance']);
});

test('the ordinary prepaid stay offers nothing', () => {
  assert.deepEqual(collectibleArrivalBuckets({
    depositAmount: 200, depositPaid: 1, balanceAmount: 300, balancePaid: 1, complementAmount: 0,
  }), []);
});

test('the three buckets come back in payment order, acompte first', () => {
  const out = collectibleArrivalBuckets({
    depositAmount: 200, balanceAmount: 300, complementAmount: 50,
  });
  assert.deepEqual(out.map((b) => b.bucket), ['deposit', 'balance', 'complement']);
});

// ── validateArrivalPaymentDate ──────────────────────────────────────────────────────────────────

test('a past date is accepted — recording late is the whole point', () => {
  assert.deepEqual(
    validateArrivalPaymentDate('2026-08-30', { today: '2026-08-31', bookedAt: '2026-08-01' }),
    { ok: true, date: '2026-08-30' },
  );
});

test('today is accepted', () => {
  assert.equal(validateArrivalPaymentDate('2026-08-31', { today: '2026-08-31' }).ok, true);
});

test('a future date is refused: the money has not been received', () => {
  const r = validateArrivalPaymentDate('2026-09-01', { today: '2026-08-31' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /futur/);
});

test('a date before the booking existed is refused', () => {
  const r = validateArrivalPaymentDate('2026-07-30', { today: '2026-08-31', bookedAt: '2026-08-01' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /n'existait pas encore le 30\/07\/2026/);
});

test('a malformed or impossible date is refused, never coerced', () => {
  for (const bad of ['', null, 'hier', '31/08/2026', '2026-8-3', '2026-02-31']) {
    const r = validateArrivalPaymentDate(bad, { today: '2026-08-31' });
    assert.equal(r.ok, false, `${bad} should be refused`);
  }
});

test('without a booking date, only the future check applies', () => {
  assert.equal(validateArrivalPaymentDate('2020-01-01', { today: '2026-08-31' }).ok, true);
});
