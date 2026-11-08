// Audit R28 verification V1 (2026-11-08) — specs/reservation-payment-ledger.md rule 69 and
// specs/defer-arrival-complement-to-checkout.md rule 8. A credit confirmed on the merged « Complément de fin de séjour »
// receipt settles both buckets together; the receipt stays the merged one, reconciled, and « Défaire » clears both.
const test = require('node:test');
const assert = require('node:assert/strict');
const { USER, addReservation, credit, build, reset, row, dayAt } = require('./reconciliationFixture');

test.beforeEach(() => { reset(); });

const itemsOf = (controller, id, view) => controller.list({ view }).body.items
  .filter((i) => i.reservation && i.reservation.id === id)
  .map((i) => [i.ledgerKey, i.expectedCents]);

test('a merged receipt confirmed stays reconciled as one; « Défaire » clears the arrival part and the end of stay', () => {
  const id = addReservation({
    finalPrice: 732, balanceAmount: 700, balancePaid: 1, balancePaidDate: dayAt(-25),
    complementAmount: 20, complementDeferredToCheckout: 1, endOfStayComplementAmount: 12,
  });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('m1', 3200)], { bankAccountId: 'acc-1' });
  const confirmed = controller.confirm({ transactionId: 'm1', allocations: [{ reservationId: id, ledgerKey: 'checkoutComplement', amountCents: 3200 }], user: USER });
  assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
  let r = row(id);
  assert.deepEqual([r.complementPaid, r.endOfStayComplementPaid], [1, 1]);
  assert.equal(r.endOfStayComplementPaidDate, r.complementPaidDate);
  assert.deepEqual(itemsOf(controller, id, 'done'), [['checkoutComplement', 3200]]);
  assert.deepEqual(itemsOf(controller, id, 'todo').filter(([key]) => /omplement/i.test(key)), []);

  const undone = controller.undo({ transactionId: 'm1', user: USER });
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  r = row(id);
  assert.deepEqual([r.complementPaid, r.endOfStayComplementPaid, r.endOfStayComplementPaidDate], [0, 0, null]);
  assert.deepEqual(itemsOf(controller, id, 'done'), []);
});
