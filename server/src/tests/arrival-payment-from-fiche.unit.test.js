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

// specs/single-payment-from-the-fiche.md rule 2
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

// specs/single-payment-from-the-fiche.md rule 2
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

// specs/single-payment-from-the-fiche.md rule 2
test('the ordinary prepaid stay offers nothing', () => {
  assert.deepEqual(collectibleArrivalBuckets({
    depositAmount: 200, depositPaid: 1, balanceAmount: 300, balancePaid: 1, complementAmount: 0,
  }), []);
});

// specs/single-payment-from-the-fiche.md rule 3
test('the buckets come back in payment order, acompte first', () => {
  const out = collectibleArrivalBuckets({
    depositAmount: 200, balanceAmount: 300, complementAmount: 50, endOfStayComplementAmount: 20,
  });
  assert.deepEqual(out.map((b) => b.bucket), ['deposit', 'balance', 'complement', 'endOfStayComplement']);
});

// ── The end-of-stay complement (rule 2bis, 2026-08-31) ──────────────────────────────────────────
// Reported from production: a platform booking with the acompte disabled, nothing sold at check-in
// and 50 € sitting in the end-of-stay complement offered NO control at all — one collectible bucket.
// The guest had nonetheless paid everything on arrival.

// specs/single-payment-from-the-fiche.md rule 2bis
test('an unpaid end-of-stay complement is collectible with the stay', () => {
  const out = collectibleArrivalBuckets({
    depositDisabled: 1, depositAmount: 0,
    balanceAmount: 1933.52, complementAmount: 0, endOfStayComplementAmount: 50,
  });
  assert.deepEqual(out, [
    { bucket: 'balance', label: 'solde', amount: 1933.52 },
    { bucket: 'endOfStayComplement', label: 'complément de fin de séjour', amount: 50 },
  ]);
});

// specs/single-payment-from-the-fiche.md rule 2bis
test('an end-of-stay complement already settled — cash included — is left alone', () => {
  const paid = collectibleArrivalBuckets({
    balanceAmount: 300, endOfStayComplementAmount: 50, endOfStayComplementPaid: 1,
  });
  assert.deepEqual(paid.map((b) => b.bucket), ['balance']);
  const cash = collectibleArrivalBuckets({
    balanceAmount: 300, endOfStayComplementAmount: 50, endOfStayComplementPaidCash: 1,
  });
  assert.deepEqual(cash.map((b) => b.bucket), ['balance'], 'caisse interne counts as settled');
});

// ── validateArrivalPaymentDate ──────────────────────────────────────────────────────────────────

// specs/single-payment-from-the-fiche.md rule 3bis
test('a past date is accepted — recording late is the whole point', () => {
  assert.deepEqual(
    validateArrivalPaymentDate('2026-08-30', { today: '2026-08-31', bookedAt: '2026-08-01' }),
    { ok: true, date: '2026-08-30' },
  );
});

test('today is accepted', () => {
  assert.equal(validateArrivalPaymentDate('2026-08-31', { today: '2026-08-31' }).ok, true);
});

// specs/single-payment-from-the-fiche.md rule 3bis
test('a future date is refused: the money has not been received', () => {
  const r = validateArrivalPaymentDate('2026-09-01', { today: '2026-08-31' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /futur/);
});

// specs/single-payment-from-the-fiche.md rule 3bis
test('a date before the booking existed is refused', () => {
  const r = validateArrivalPaymentDate('2026-07-30', { today: '2026-08-31', bookedAt: '2026-08-01' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /n'existait pas encore le 30\/07\/2026/);
});

// specs/single-payment-from-the-fiche.md rule 3bis
test('a malformed or impossible date is refused, never coerced', () => {
  for (const bad of ['', null, 'hier', '31/08/2026', '2026-8-3', '2026-02-31']) {
    const r = validateArrivalPaymentDate(bad, { today: '2026-08-31' });
    assert.equal(r.ok, false, `${bad} should be refused`);
  }
});

test('without a booking date, only the future check applies', () => {
  assert.equal(validateArrivalPaymentDate('2020-01-01', { today: '2026-08-31' }).ok, true);
});
