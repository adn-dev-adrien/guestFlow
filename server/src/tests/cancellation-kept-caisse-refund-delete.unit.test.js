// specs/payment-schedule-and-cancellation.md rule 62 (verification R44b N1, 2026-11-10) — a caisse-interne refund made
// before the cancel was read by the sum kept (rule 61): deleting it from the cancelled fiche would raise a sum the
// notice already stated, so it is refused 409 REFUND_NETTED_BY_CANCELLATION and the figure holds.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, respond, rowOf, mark, ADMIN, WITH_ACOMPTE, D, fiche, refund } = require('./moneyLedgerFixture');
const cancellationController = require('../controllers/reservationCancellationController');
const refundsController = require('../controllers/refundsController');
const { cancellationKeptForEmail } = require('../utils/cancellationKeptForEmail');

const cents = (euros) => Math.round(Number(euros) * 100);
async function cancel(id) {
  const res = respond();
  await cancellationController.cancel({ params: { id: String(id) }, body: { reason: 'x', notifyClient: false }, user: ADMIN }, res);
  return res.body;
}
function remove(id, refundId) {
  const res = respond();
  refundsController.remove({ params: { id: String(id), refundId: String(refundId) } }, res);
  return res;
}
const caisseAcompte = (id) => {
  const due = cents(rowOf(id).depositAmount);
  return mark(id, { ...D, expectedAmountCents: due, tenders: [{ method: 'cash', amountCents: due, internal: true }] });
};

test('rule 62: a pre-cancel caisse refund the sum kept read cannot be deleted; the notice figure holds', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(caisseAcompte(stay.id).statusCode, 200);
  const given = refund(stay.id, [{ key: 'accommodation', amountTtc: 50 }], 'internal');
  assert.equal(given.statusCode, 201);
  const done = await cancel(stay.id);
  const res = remove(stay.id, given.body.refund.id);
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'REFUND_NETTED_BY_CANCELLATION');
  assert.equal(cancellationKeptForEmail(db, rowOf(stay.id)), done.keptFromGuest);
});

