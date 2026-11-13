// specs/pricing-components.md §3 rule 72 — REFUNDS / cancellation: the arithmetic of a cancellation, moved unchanged from
// `cancelReservation`, `cancellationRequalification` and `cancellationKeptForEmail`: the reason, what the book refunds
// gave back per bucket, the caisse acompte kept, the signature of what was kept, the sum a later refund takes from it, and
// the requalification avoir with its indemnity. Old paths re-export. No DB, plain objects.
const test = require('node:test');
const assert = require('node:assert/strict');
const cancellation = require('../utils/pricing/refunds/cancellation');
const cancelReservation = require('../utils/cancelReservation');
const legacy = require('../utils/cancellationRequalification');

const {
  buildCancellationRequalification, resolveCancellationReason, givenBackByBucket, keptSignature, cashDepositKeptOf, givenBackSinceCancelOf,
} = cancellation;

test('rule 72 — the old modules re-export the same functions', () => {
  assert.equal(legacy.buildCancellationRequalification, buildCancellationRequalification);
  assert.equal(cancelReservation.resolveCancellationReason, resolveCancellationReason);
  assert.equal(cancelReservation.cashDepositKeptOf, cashDepositKeptOf);
  assert.equal(legacy.__test.round2, cancellation.__test.round2);
});

test('rule 72 — the reason is read from the state of the money: the first money missing wins', () => {
  assert.equal(resolveCancellationReason({ depositAmount: 100, depositPaid: 0 }), 'unpaid_deposit');
  assert.equal(resolveCancellationReason({ depositAmount: 100, depositPaid: 1, balanceAmount: 200, balancePaid: 0 }), 'unpaid_balance');
  assert.equal(resolveCancellationReason({ depositAmount: 100, depositPaid: 1, installmentsUnpaidAmount: 50 }), 'unpaid_balance');
  assert.equal(resolveCancellationReason({ depositAmount: 100, depositPaid: 1, balancePaid: 1 }), 'manual');
});

test('rule 72 — givenBackByBucket counts the book refunds only: the caisse interne and the avoir give nothing back', () => {
  assert.deepEqual(givenBackByBucket([
    { method: 'transfer', lines: [{ bucket: 'accommodation', amountTtc: 10.1 }, { bucket: 'options', amountTtc: 5 }] },
    { method: 'internal', lines: [{ bucket: 'accommodation', amountTtc: 99 }] },
    { method: 'retained', lines: [{ bucket: 'accommodation', amountTtc: 77 }] },
    { method: 'cash', lines: [{ bucket: 'accommodation', amountTtc: 0.2 }] },
  ]), { accommodation: 10.3, options: 5 });
  assert.deepEqual(givenBackByBucket(null), {});
});

test('rule 72 — the caisse acompte kept: the acompte, less what the other caisse money no longer covers after the caisse refunds', () => {
  const cashDeposit = { depositPaid: 1, depositPaidCash: 1, depositAmount: 100 };
  assert.equal(cashDepositKeptOf(cashDeposit, []), 100);
  assert.equal(cashDepositKeptOf({ depositPaid: 1, depositPaidCash: 0, depositAmount: 100 }, []), 0, 'a book acompte is requalified, not kept in the caisse');
  const withSolde = { ...cashDeposit, balancePaid: 1, balancePaidCash: 1, balanceAmount: 300 };
  assert.equal(cashDepositKeptOf(withSolde, [{ method: 'internal', totalTtc: 350 }]), 50);
  assert.equal(cashDepositKeptOf(withSolde, [{ method: 'transfer', totalTtc: 350 }]), 100, 'a book refund never reduces the caisse');
});

test('rule 72 — keptSignature compares the money kept, not how the solde commission was spread', () => {
  const sale = { lineKey: 'accommodation', bucket: 'accommodation', label: 'H', amountTtc: 90, vatRate: 10 };
  const spreadOne = keptSignature(100, [sale, { lineKey: 'commission', bucket: 'accommodation', label: 'C', amountTtc: 10, vatRate: 0 }]);
  const spreadTwo = keptSignature(100, [sale, { lineKey: 'commission', bucket: 'options', label: 'C2', amountTtc: 10, vatRate: 0 }]);
  assert.equal(spreadOne, spreadTwo);
  assert.notEqual(spreadOne, keptSignature(100, [{ ...sale, amountTtc: 89.99 }, { lineKey: 'commission', bucket: 'options', label: 'C2', amountTtc: 10, vatRate: 0 }]));
  assert.notEqual(spreadOne, keptSignature(100, [sale, { lineKey: 'commission', bucket: 'options', label: 'C2', amountTtc: 9, vatRate: 0 }]));
});

test('specs/payment-schedule-and-cancellation.md rule 62 — a later refund takes from the kept sum its indemnity lines and the caisse acompte the other caisse money no longer covers', () => {
  // date-literal-ok: stamps compared with each other only, the refunds carry the flag
  const row = { cancelledAt: '2020-01-01 10:00:00', depositPaid: 1, depositPaidCash: 1, depositAmount: 100 };
  const refunds = [
    { id: 1, method: 'retained', totalTtc: 100, lines: [] },
    { id: 2, method: 'transfer', afterCancellation: 1, lines: [{ bucket: 'indemnity', amountTtc: 30 }] },
    { id: 3, method: 'internal', afterCancellation: 1, totalTtc: 40, lines: [] },
  ];
  assert.equal(givenBackSinceCancelOf({ row, refunds, withCash: true }), 70);
  assert.equal(givenBackSinceCancelOf({ row, refunds, withCash: false }), 30);
  assert.equal(givenBackSinceCancelOf({ row, refunds: [refunds[0]], withCash: true }), 0);
});

test('rule 72 — the avoir mirrors the acompte per bucket, net of what the earlier refunds took; an unpaid acompte requalifies nothing', () => {
  const reservation = { depositPaid: 1, depositAmount: 274 };
  const out = buildCancellationRequalification({
    reservation, depositBuckets: { accommodation: 220, options: 40, resources: 14 }, givenBack: { accommodation: 20 }, cancellationDate: '2026-08-19', vatRate: 10, // date-literal-ok: a label carried to the records
  });
  assert.deepEqual(out.refund.lines.map((line) => [line.bucket, line.amountTtc]), [['accommodation', 200], ['options', 40], ['resources', 14]]);
  assert.equal(out.retainedTtc, 254);
  assert.equal(out.requalifiedTtc, 254);
  assert.equal(buildCancellationRequalification({ reservation: { depositPaid: 0, depositAmount: 0 }, cancellationDate: '2026-08-19' }), null); // date-literal-ok: a label carried to the records
});

test('rule 70 — a commission withheld on a paid solde is requalified alone, as a commission line', () => {
  const out = buildCancellationRequalification({
    reservation: { depositPaid: 0, depositAmount: 0 }, withheldCommissions: { soldeTtc: 12 }, cancellationDate: '2026-08-19', vatRate: 10, // date-literal-ok: a label carried to the records
  });
  assert.equal(out.retainedTtc, 0);
  assert.equal(out.requalifiedTtc, 12);
  assert.equal(out.withheldTtc, 12);
  assert.deepEqual(out.refund.lines.map((line) => [line.lineKey, line.amountTtc]), [['commission', 12]]);
});
