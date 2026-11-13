// specs/pricing-components.md §3 rule 72 — REFUNDS / judge: the write judge of the register (`validateRefundPayload`, today
// injected), the refusal to delete a refund the cancellation read, the book-money test of a cancellation, and the refusal
// to take a mark back below the refunds already given (specs/reservation-refunds.md rule 52), the projected split being injected by the caller.
const test = require('node:test');
const assert = require('node:assert/strict');
const judge = require('../utils/pricing/refunds/judge');
const legacy = require('../utils/refunds');
const guard = require('../utils/refundUntickGuard');
const { buildRefundableLines } = require('../utils/pricing/refunds/refundable');

const { validateRefundPayload, refundDeletionRefusal, cancellationHadBookMoney, untickRefusal, lastBookPaymentDateOf } = judge;

// date-literal-ok: the day is injected (`today`), nothing here reads the clock
const TODAY = '2026-08-20';
const PAST = '2026-08-14'; // date-literal-ok: judged against the injected `today`
const STAY = {
  finalPrice: 480,
  touristTaxTotal: 13.2,
  vatRate: 10,
  options: [{ optionId: 7, title: 'Petit-déjeuner', totalPrice: 72, billedUnits: 6, offered: 0 }],
};
const context = () => ({
  refundableLines: buildRefundableLines({ ...STAY, refunds: [] }),
  finalPrice: 480,
  touristTaxTotal: 13.2,
  alreadyRefundedTotal: 0,
  vatRate: 10,
  today: TODAY,
});

test('rule 72 — the legacy module and the guard re-export the judge', () => {
  assert.equal(legacy.validateRefundPayload, validateRefundPayload);
  assert.equal(legacy.refundDeletionRefusal, refundDeletionRefusal);
  assert.equal(legacy.lastBookPaymentDateOf, lastBookPaymentDateOf);
  assert.equal(typeof guard.untickRefusal, 'function');
});

test('rule 72 — a refund of two breakfasts is normalised at the line price and the frozen rate', () => {
  const result = validateRefundPayload({ refundDate: PAST, method: 'transfer', lines: [{ key: 'opt:7', quantity: 2, amountTtc: 24 }] }, context());
  assert.equal(result.refund.totalTtc, 24);
  assert.deepEqual(result.refund.lines, [{
    lineKey: 'opt:7', label: 'Petit-déjeuner', bucket: 'options', quantity: 2, unitPrice: 12, amountTtc: 24, vatRate: 10,
  }]);
});

test('rule 72 — the refusals: unknown means, above the line, a future day, no line', () => {
  const refusal = (payload) => {
    const { code, status } = validateRefundPayload(payload, context());
    return [code, status];
  };
  assert.deepEqual(refusal({ refundDate: PAST, method: 'cheque', lines: [{ key: 'opt:7', amountTtc: 24 }] }), ['REFUND_INVALID_METHOD', 400]);
  assert.deepEqual(refusal({ refundDate: PAST, lines: [{ key: 'opt:7', amountTtc: 90 }] }), ['REFUND_EXCEEDS_LINE', 409]);
  assert.deepEqual(refusal({ refundDate: '2026-08-30', lines: [{ key: 'opt:7', amountTtc: 9 }] }), ['REFUND_INVALID_DATE', 400]); // date-literal-ok: after the injected `today`
  assert.deepEqual(refusal({ refundDate: PAST, lines: [] }), ['REFUND_INVALID_AMOUNT', 400]);
});

test('rule 72 — the avoir cannot be deleted; a refund the cancellation read is refused as netted', () => {
  assert.deepEqual(refundDeletionRefusal({ id: 2, method: 'retained' }, [{ id: 2, method: 'retained' }], {}), {
    code: 'REFUND_RETAINED_AVOIR', error: 'L’indemnité d’annulation ne se supprime pas.',
  });
  const register = [{ id: 1, method: 'transfer' }, { id: 2, method: 'retained' }];
  assert.equal(refundDeletionRefusal(register[0], register, { kind: 'cancelled', depositPaid: 1, depositAmount: 100 }).code, 'REFUND_NETTED_BY_CANCELLATION');
});

test('rule 72 — a cancellation had book money to keep when an acompte, installments or a withheld solde commission were paid', () => {
  assert.equal(cancellationHadBookMoney({ depositPaid: 1, depositAmount: 100 }), true);
  assert.equal(cancellationHadBookMoney({ depositPaid: 1, depositPaidCash: 1, depositAmount: 100 }), false);
  assert.equal(cancellationHadBookMoney({ balancePaid: 1, balanceAmount: 5 }), false);
  assert.equal(cancellationHadBookMoney({ balancePaid: 1, platformCommissionAmount: 12 }), true);
});

test('specs/reservation-refunds.md rule 52 — untickRefusal names the refunds a take-back would leave above what stays collected; the split is injected', () => {
  const row = { platform: 'direct', depositPaid: 1, depositAmount: 100, balancePaid: 1, balanceAmount: 200 };
  const refunds = [{ id: 5, method: 'transfer', totalTtc: 150, refundDate: PAST }];
  let projected = null;
  const refusal = untickRefusal(row, { balancePaid: 0 }, refunds, (next) => {
    projected = next;
    return { splitOffBooksAmount: 0, splitWaivedAmount: 0, splitShortfallDue: 0 };
  });
  assert.equal(projected.balancePaid, 0, 'the projection reads the row as the gesture writes it');
  assert.equal(refusal.status, 409);
  assert.equal(refusal.body.code, 'REFUND_BLOCKS_UNTICK');
  assert.deepEqual(refusal.body.refundIds, [5]);
  assert.match(refusal.body.error, /^Remboursement du 14\/08\/2026 \(150,00\s€\) à supprimer d’abord\.$/);
});

test('specs/reservation-refunds.md rule 52 — nothing refunded on the books, or a gesture that keeps enough collected, is not refused', () => {
  const row = { platform: 'direct', depositPaid: 1, depositAmount: 100, balancePaid: 1, balanceAmount: 200 };
  const split = () => ({ splitOffBooksAmount: 0, splitWaivedAmount: 0, splitShortfallDue: 0 });
  assert.equal(untickRefusal(row, { balancePaid: 0 }, [], split), null);
  assert.equal(untickRefusal(row, { balancePaid: 0 }, [{ id: 1, method: 'internal', totalTtc: 150 }], split), null, 'the caisse interne is off the books');
  assert.equal(untickRefusal(row, { balancePaid: 0 }, [{ id: 1, method: 'transfer', totalTtc: 90 }], split), null);
});

test('rule 72 — the last book payment date comes from the paid buckets', () => {
  assert.equal(lastBookPaymentDateOf({ depositPaid: 1, depositPaidDate: '2026-08-01' }, {}), '2026-08-01'); // date-literal-ok: read back as given
});
