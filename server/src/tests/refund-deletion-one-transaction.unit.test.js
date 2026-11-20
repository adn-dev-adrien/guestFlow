// specs/pricing-components.md §3 rule 119 and specs/reservation-refunds.md rule 6 (stabilisation loop t9, D9-3, 2026-11-16) — deleting a refund
// on the trop-perçu, reopening the `lineLowered` rows it settled and writing the rule-119 credit are ONE transaction. A failure on the way
// (injected in the reopen) leaves the refund, its settled rows and their `noteCents` as they were. Before, the refund row was already gone
// while the obligation stayed settled by it: note money read as refunded by a refund that no longer existed.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refunds = require('../controllers/refundsController');
const obligationsModel = require('../models/refundObligationsModel');
const { storedBody } = require('../utils/stayOrderLines');

const respond = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const call = (handler, params, body) => { const res = respond(); handler({ params, body, query: {}, user: { id: 1, role: 'admin' } }, res); return res; };
const lowered = (id) => db.prepare("SELECT status, settledBy, noteCents FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' ORDER BY id").all(id);
const refundCount = (id) => db.prepare('SELECT COUNT(*) AS n FROM reservation_refunds WHERE reservationId = ?').get(id).n;
const deletions = (id) => db.prepare("SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = ? AND eventType = 'refundDeleted'").get(id).n;

function refundedStay() {
  const id = stay(3);
  const now = new Date(`${addDaysToIsoDate(row(id).startDate, -3)}T12:00:00`);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(todayIso(), id);
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-d93' }, orderRef: 'order:card-d93' }).status, 200);
  const ref = `option:${db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, beer).lineId}`;
  let res = extraSale.changeLine(id, ref, { offered: true }, { now });
  if (res.status === 409 && res.body.code === 'OVERPAID') res = extraSale.changeLine(id, ref, { offered: true }, { now, forceOverpayment: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const made = call(refunds.create, { id: String(id) }, { refundDate: todayIso(), method: 'transfer', fromOverpayment: true, overpaymentTtc: 30, lines: [{ amountTtc: 30, label: 'Trop-perçu' }] });
  assert.equal(made.statusCode, 201, JSON.stringify(made.body));
  return { id, refundId: made.body.refund.id };
}

test('D9-3 — a failure in the reopen rolls the deletion back whole', () => {
  const { id, refundId } = refundedStay();
  const before = lowered(id);
  assert.deepEqual(before, [{ status: 'settled', settledBy: `refund:${refundId}`, noteCents: 3000 }]);
  const original = obligationsModel.reopenSettledBy;
  obligationsModel.reopenSettledBy = (...args) => { original(...args); throw new Error('injected'); };
  try {
    assert.throws(() => call(refunds.remove, { id: String(id), refundId: String(refundId) }), /injected/);
  } finally {
    obligationsModel.reopenSettledBy = original;
  }
  assert.equal(refundCount(id), 1, 'the refund is still there');
  assert.deepEqual(lowered(id), before);
  assert.equal(deletions(id), 0);
});

test('D9-3 — without a failure the deletion still reopens and records', () => {
  const { id, refundId } = refundedStay();
  const res = call(refunds.remove, { id: String(id), refundId: String(refundId) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(refundCount(id), 0);
  assert.deepEqual(lowered(id).map((r) => [r.status, r.noteCents]), [['open', 0]]);
  assert.equal(deletions(id), 1);
});
