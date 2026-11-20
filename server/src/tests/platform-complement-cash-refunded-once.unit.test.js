// specs/pricing-components.md §3 rules 112, 115, 116 (stabilisation loop t9, D9-1, 2026-11-16) — on a platform stay the cash a caisse-interne
// refund already gave back is every cent it settled, as `refundedClaimedCents` reads it: no trop-perçu opens a lowered row there, so the arrival
// complement's cash counts as much as a note's. Booking: beer 30 in the complement collected « caisse interne », breakfast 60 sold by a card note.
// The beer offered and its 30 € refunded through the till, then the breakfast offered: the 60 € trop-perçu is card money — no « Caisse interne »
// part. Before, the till's 30 € was counted again (30 cash + 30 rest), and 30 € of booked card revenue got no avoir.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, breakfast, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refunds = require('../controllers/refundsController');
const { storedBody } = require('../utils/stayOrderLines');
const { cashNoteExcessCents } = require('../utils/cashNoteExcess');

const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const call = (handler, params, body) => { const res = respond(); handler({ params, body, query: {}, user: { id: 1, role: 'admin' } }, res); return res; };

function bookingStayWithCashComplement() {
  const id = stay(20);
  db.prepare("UPDATE reservations SET platform = 'Booking' WHERE id = ?").run(id);
  const body = storedBody(id);
  body.options = [...(body.options || []), { optionId: beer, quantity: 5 }];
  ctrl.performUpdate(id, { ...body, restatePricing: true });
  assert.equal(call(ctrl.updatePayment, { id: String(id) }, { balancePaid: true, balancePaidDate: todayIso() }).statusCode, 200);
  assert.equal(call(ctrl.updatePayment, { id: String(id) }, { complementPaidCash: true, complementPaidDate: todayIso() }).statusCode, 200);
  const now = new Date(`${addDaysToIsoDate(row(id).startDate, -2)}T12:00:00`);
  const requests = [{ articleRef: `option:${breakfast}`, quantity: 1 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  const sold = extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-d91' }, orderRef: 'order:card-d91' });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  return { id, now };
}

function offer(id, article, now) {
  const ref = extraSale.saleDetailOf(id, now).lines.find((l) => l.articleKey === `option:${article}`).ref;
  let res = extraSale.changeLine(id, ref, { offered: true }, { now });
  if (res.status === 409 && res.body.code === 'OVERPAID') res = extraSale.changeLine(id, ref, { offered: true }, { now, forceOverpayment: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

test('D9-1 — the complement cash refunded through the till is not proposed a second time', () => {
  const { id, now } = bookingStayWithCashComplement();
  offer(id, beer, now);
  const first = ctrl.storedOverpayment(id);
  assert.equal(first.overpaymentTtc, 30);
  assert.equal(first.overpaymentMethod, 'internal');
  assert.equal(cashNoteExcessCents(db, id), 3000);
  const made = call(refunds.create, { id: String(id) }, {
    refundDate: todayIso(), method: 'internal', reason: 'Trop-perçu', fromOverpayment: true, overpaymentTtc: first.overpaymentTtc,
    lines: first.overpaymentLines.map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amountTtc: l.amountTtc })),
  });
  assert.equal(made.statusCode, 201, JSON.stringify(made.body));

  offer(id, breakfast, now);
  const second = ctrl.storedOverpayment(id);
  assert.equal(second.overpaymentTtc, 60);
  assert.equal(cashNoteExcessCents(db, id), 0, 'the till gave its 30 € back already');
  assert.ok(!second.overpaymentCash, JSON.stringify(second.overpaymentCash));
  assert.notEqual(second.overpaymentMethod, 'internal');
});
