// Audit R29-DB-1 (2026-11-08) — specs/defer-arrival-complement-to-checkout.md rule 24 and
// specs/reservation-payment-ledger.md rule 69. A deferred arrival complement with no end of stay (0 €): the credit
// confirmed on the merged « Complément de fin de séjour » receipt marks the arrival part, and the card stays the merged
// one, so the receipt stays « Rapproché » instead of coming back as « Saisi, rien sur le compte » on a « Complément
// d'arrivée » the bank never paid. « Défaire » takes the arrival part back.
const test = require('node:test');
const assert = require('node:assert/strict');
const { USER, addReservation, credit, build, reset, row, dayAt } = require('./reconciliationFixture');

test.beforeEach(() => { reset(); });

const itemsOf = (controller, id, view) => controller.list({ view }).body.items
  .filter((i) => i.reservation && i.reservation.id === id)
  .map((i) => [i.ledgerKey, i.expectedCents, i.state]);

test('a merged receipt at 0 € of end of stay stays reconciled once confirmed; « Défaire » re-opens it', () => {
  const id = addReservation({
    finalPrice: 745, balanceAmount: 700, balancePaid: 1, balancePaidDate: dayAt(-25),
    complementAmount: 45, complementDeferredToCheckout: 1, endOfStayComplementAmount: 0,
  });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('m1', 4500)], { bankAccountId: 'acc-1' });
  const confirmed = controller.confirm({ transactionId: 'm1', allocations: [{ reservationId: id, ledgerKey: 'checkoutComplement', amountCents: 4500 }], user: USER });
  assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
  let r = row(id);
  assert.deepEqual([r.complementPaid, r.endOfStayComplementPaid, r.endOfStayComplementPaidDate], [1, 0, null]);
  assert.deepEqual(itemsOf(controller, id, 'done'), [['checkoutComplement', 4500, 'reconciled']]);
  assert.deepEqual(itemsOf(controller, id, 'todo').filter(([key]) => /omplement/i.test(key)), []);

  const undone = controller.undo({ transactionId: 'm1', user: USER });
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  r = row(id);
  assert.deepEqual([r.complementPaid, r.complementPaidDate], [0, null]);
  assert.deepEqual(itemsOf(controller, id, 'done'), []);
});
