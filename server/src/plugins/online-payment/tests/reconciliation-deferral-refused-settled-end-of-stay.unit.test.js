// Audit R28 verification N2, probe (c) (2026-11-08) — specs/defer-arrival-complement-to-checkout.md rule 23. An end of
// stay reconciled on its own credit, then the deferral switched on and the complement marked on the credit's day, read
// as settled together: the 12 € credit left the done view and the to-do view asked for a merged 32 € « Saisi, rien sur
// le compte ». The deferral switch is refused while the end of stay is settled, so the credit stays reconciled on it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { USER, addReservation, credit, build, reset, row, dayAt } = require('./reconciliationFixture');
const reservationsController = require('../../../controllers/reservationsController');

test.beforeEach(() => { reset(); });

const itemsOf = (controller, id, view) => controller.list({ view }).body.items
  .filter((i) => i.reservation && i.reservation.id === id && /omplement/i.test(i.ledgerKey))
  .map((i) => [i.ledgerKey, i.expectedCents]);

function patch(id, body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  reservationsController.updatePayment({ params: { id: String(id) }, body, user: USER }, res);
  return res;
}

test('an end of stay reconciled on its own credit refuses the deferral; the credit stays reconciled on it', () => {
  const id = addReservation({
    finalPrice: 732, balanceAmount: 700, balancePaid: 1, balancePaidDate: dayAt(-25), complementAmount: 20, endOfStayComplementAmount: 12,
  });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('e1', 1200)], { bankAccountId: 'acc-1' });
  const confirmed = controller.confirm({ transactionId: 'e1', allocations: [{ reservationId: id, ledgerKey: 'endOfStayComplement', amountCents: 1200 }], user: USER });
  assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));

  const refused = patch(id, { complementDeferredToCheckout: true });
  assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.code, 'DEFERRAL_END_OF_STAY_SETTLED');
  assert.equal(row(id).complementDeferredToCheckout, 0);

  const marked = patch(id, { complementPaid: true, complementPaidDate: row(id).endOfStayComplementPaidDate });
  assert.equal(marked.statusCode, 200, JSON.stringify(marked.body));
  assert.deepEqual(itemsOf(controller, id, 'done'), [['endOfStayComplement', 1200]]);
  assert.deepEqual(itemsOf(controller, id, 'todo').map(([key]) => key), ['complement']);
});
