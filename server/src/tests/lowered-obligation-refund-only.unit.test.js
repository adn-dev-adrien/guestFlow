// specs/pricing/pricing-components.md §3 rule 120 (stabilisation loop t9, D9-2, 2026-11-16) — a lowered paid line's « À rembourser » row is the
// trop-perçu (rule 75, the same money with one face): it closes through a refund on the trop-perçu, which stamps its note part (rule 115),
// never by hand. PATCH /refund-obligations/:oid on it answers 409 OBLIGATION_REFUND_ONLY and leaves the row open, so the trop-perçu still
// asks for it and rule 108 still holds once it is refunded. Before, a hand close counted as nothing refunded: the line could be put back to
// billed while the guest kept the 30 € given back, and the trop-perçu still showed 30 € to refund.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refunds = require('../controllers/refundsController');
const obligationsCtrl = require('../controllers/refundObligationsController');
const { storedBody } = require('../utils/stayOrderLines');

const respond = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const call = (handler, params, body) => { const res = respond(); handler({ params, body, query: {}, user: { id: 1, role: 'admin' } }, res); return res; };
const lowered = (id) => db.prepare("SELECT * FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' ORDER BY id").all(id);
const beerRef = (id) => `option:${db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, beer).lineId}`;

function stayWithBeerOffered() {
  const id = stay(3);
  const now = new Date(`${addDaysToIsoDate(row(id).startDate, -3)}T12:00:00`);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(todayIso(), id);
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-d92' }, orderRef: 'order:card-d92' }).status, 200);
  let res = extraSale.changeLine(id, beerRef(id), { offered: true }, { now });
  if (res.status === 409 && res.body.code === 'OVERPAID') res = extraSale.changeLine(id, beerRef(id), { offered: true }, { now, forceOverpayment: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { id, now };
}

test('D9-2 — a lineLowered row cannot be closed by hand, settled or cancelled', () => {
  const { id } = stayWithBeerOffered();
  const [open] = lowered(id);
  assert.equal(open.status, 'open');
  assert.equal(open.amountCents, 3000);
  for (const status of ['settled', 'cancelled']) {
    const res = call(obligationsCtrl.closeObligation, { id: String(id), oid: String(open.id) }, { status });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'OBLIGATION_REFUND_ONLY');
  }
  assert.equal(lowered(id)[0].status, 'open');
  assert.equal(ctrl.storedOverpayment(id).overpaymentTtc, 30);
});

test('D9-2 — refunded through the trop-perçu, the line stays offered (rule 108)', () => {
  const { id, now } = stayWithBeerOffered();
  const made = call(refunds.create, { id: String(id) }, { refundDate: todayIso(), method: 'transfer', fromOverpayment: true, overpaymentTtc: 30, lines: [{ amountTtc: 30, label: 'Trop-perçu' }] });
  assert.equal(made.statusCode, 201, JSON.stringify(made.body));
  assert.deepEqual(lowered(id).map((r) => [r.status, r.noteCents]), [['settled', 3000]]);
  const back = extraSale.changeLine(id, beerRef(id), { offered: false }, { now });
  assert.equal(back.status, 409);
  assert.equal(back.body.code, 'LINE_REFUNDED');
});

test('other origins still close by hand', () => {
  const id = stay(3);
  const open = require('../models/refundObligationsModel').open({ reservationId: id, origin: 'duplicatePayment', amountCents: 1500 });
  const res = call(obligationsCtrl.closeObligation, { id: String(id), oid: String(open.id) }, { status: 'settled' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.obligation.status, 'settled');
});
