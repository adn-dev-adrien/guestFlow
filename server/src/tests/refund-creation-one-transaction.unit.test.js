// specs/pricing-components.md §3 rule 115 and specs/reservation-refunds.md rule 6 (stabilisation loop t9, D9-3 follow-up, 2026-11-16) — a
// refund on the trop-perçu, its history entry and the `lineLowered` rows it settles (with their `noteCents`) are ONE transaction. A failure
// injected in the settlement leaves no refund, no history entry and the row open. Before, the refund row and its history were already written
// while the obligation stayed open: the trop-perçu asked again for money already given back.
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
const refundHistory = (id) => db.prepare("SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = ? AND eventType = 'refund'").get(id).n;
const refundOver = (id) => call(refunds.create, { id: String(id) }, { refundDate: todayIso(), method: 'transfer', fromOverpayment: true, overpaymentTtc: 30, lines: [{ amountTtc: 30, label: 'Trop-perçu' }] });

function stayWithBeerOffered() {
  const id = stay(3);
  const now = new Date(`${addDaysToIsoDate(row(id).startDate, -3)}T12:00:00`);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(todayIso(), id);
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-d93c' }, orderRef: 'order:card-d93c' }).status, 200);
  const ref = `option:${db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, beer).lineId}`;
  let res = extraSale.changeLine(id, ref, { offered: true }, { now });
  if (res.status === 409 && res.body.code === 'OVERPAID') res = extraSale.changeLine(id, ref, { offered: true }, { now, forceOverpayment: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return id;
}

test('D9-3 follow-up — a failure in the settlement rolls the refund back whole', () => {
  const id = stayWithBeerOffered();
  const original = obligationsModel.settleLoweredBy;
  obligationsModel.settleLoweredBy = (...args) => { original(...args); throw new Error('injected'); };
  try {
    assert.throws(() => refundOver(id), /injected/);
  } finally {
    obligationsModel.settleLoweredBy = original;
  }
  assert.equal(refundCount(id), 0, 'no refund without its settlement');
  assert.equal(refundHistory(id), 0);
  assert.deepEqual(lowered(id), [{ status: 'open', settledBy: null, noteCents: 0 }]);
  assert.equal(ctrl.storedOverpayment(id).overpaymentTtc, 30);
});

test('D9-3 follow-up — without a failure the refund settles its row and records', () => {
  const id = stayWithBeerOffered();
  const made = refundOver(id);
  assert.equal(made.statusCode, 201, JSON.stringify(made.body));
  assert.equal(refundCount(id), 1);
  assert.equal(refundHistory(id), 1);
  assert.deepEqual(lowered(id), [{ status: 'settled', settledBy: `refund:${made.body.refund.id}`, noteCents: 3000 }]);
});
