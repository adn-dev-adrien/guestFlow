// Requalifying a retained acompte (specs/payment-schedule-and-cancellation.md §3.6): the avoir that
// reverses the séjour revenue and the indemnity that credits the same sum VAT-free.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCancellationRequalification } = require('../utils/cancellationRequalification');

const RESERVATION = {
  id: 42,
  propertyId: 3,
  propertyName: 'Le Lodge',
  platform: 'direct',
  firstName: 'Marie',
  lastName: 'Dupont',
  startDate: '2026-09-18',
  endDate: '2026-09-25',
  finalPrice: 914,
  depositAmount: 274,
  depositPaid: 1,
};

test('an unpaid or absent acompte requalifies nothing (rule 27)', () => {
  assert.equal(buildCancellationRequalification({
    reservation: { ...RESERVATION, depositPaid: 0 }, cancellationDate: '2026-08-19',
  }), null);
  assert.equal(buildCancellationRequalification({
    reservation: { ...RESERVATION, depositAmount: 0 }, cancellationDate: '2026-08-19',
  }), null);
});

test('the avoir mirrors the acompte per bucket, at the sale VAT rate', () => {
  const out = buildCancellationRequalification({
    reservation: RESERVATION,
    depositBuckets: { accommodation: 220, options: 40, resources: 14 },
    cancellationDate: '2026-08-19',
    vatRate: 10,
    reason: 'Solde jamais réglé',
  });
  assert.equal(out.depositTtc, 274);
  assert.equal(out.refund.method, 'retained', 'book money, no bank movement');
  assert.equal(out.refund.refundDate, '2026-08-19', 'booked in the cancellation month, never in the acompte month');
  assert.match(out.refund.reason, /acompte conservé/i);
  assert.match(out.refund.reason, /Solde jamais réglé/);
  assert.deepEqual(out.refund.lines.map((l) => [l.bucket, l.amountTtc, l.vatRate]), [
    ['accommodation', 220, 10],
    ['options', 40, 10],
    ['resources', 14, 10],
  ]);
  const sum = out.refund.lines.reduce((t, l) => t + l.amountTtc, 0);
  assert.equal(sum, 274, 'the avoir sums to exactly what is kept');
});

test('no usable contribs → one accommodation line carrying the whole acompte', () => {
  const noBuckets = buildCancellationRequalification({
    reservation: RESERVATION, cancellationDate: '2026-08-19', vatRate: 10,
  });
  assert.deepEqual(noBuckets.refund.lines.map((l) => [l.bucket, l.amountTtc]), [['accommodation', 274]]);

  // Contribs that disagree with the stored acompte are NOT trusted: the total must stay exact.
  const stale = buildCancellationRequalification({
    reservation: RESERVATION,
    depositBuckets: { accommodation: 100, options: 0, resources: 0 },
    cancellationDate: '2026-08-19',
    vatRate: 10,
  });
  assert.deepEqual(stale.refund.lines.map((l) => [l.bucket, l.amountTtc]), [['accommodation', 274]]);
});

test('the indemnity is born banked, tagged as a retained acompte, snapshotting the stay', () => {
  const out = buildCancellationRequalification({
    reservation: RESERVATION, cancellationDate: '2026-08-19', vatRate: 10, reason: 'Sans nouvelles',
  });
  assert.deepEqual(out.compensation, {
    reservationId: 42,
    propertyId: 3,
    propertyName: 'Le Lodge',
    platform: 'direct',
    clientFirstName: 'Marie',
    clientLastName: 'Dupont',
    startDate: '2026-09-18',
    endDate: '2026-09-25',
    cancelledStayAmount: 914,
    receivedAmount: 274,
    receivedDate: '2026-08-19',
    origin: 'retained_deposit',
    notes: 'Sans nouvelles',
  });
});

test('the two records carry the same amount — the client account nets to zero', () => {
  const out = buildCancellationRequalification({
    reservation: { ...RESERVATION, depositAmount: 274.567 },
    cancellationDate: '2026-08-19', vatRate: 10,
  });
  assert.equal(out.depositTtc, 274.57, 'rounded to the cent');
  assert.equal(out.compensation.receivedAmount, out.depositTtc);
  assert.equal(out.refund.lines.reduce((t, l) => t + l.amountTtc, 0), out.depositTtc);
});
