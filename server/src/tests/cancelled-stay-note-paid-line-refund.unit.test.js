// specs/pricing/pricing-components.md §3 rule 106 d, specs/guest-app/guest-app.md rule 110 b (stabilisation loop t6, S6-1 cancelled variant and S6-6, 2026-11-16; loop t7 D7-2) — a platform
// stay whose card app order was paid before the arrival, then cancelled: the cancellation's refund dialog offers the order on its own line (it is
// money the establishment collected, never the least likely to have been), and giving it back there settles the `lineLowered` obligation an
// offer of that line had opened. Before: on 13 of 38 platform stays of the 2026-11-11 copy the order sat inside « Hébergement », and on 23 the
// obligation stayed open at 45 € after the refund.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, breakfast, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refundsController = require('../controllers/refundsController');
const reservationsModel = require('../models/reservationsModel');
const { storedBody } = require('../utils/stayOrderLines');

const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);

// A Booking stay, the platform's solde paid, 30 € of beer ordered and paid by card in the app three days before the arrival (yesterday: the refund is dated today).
function orderedBeer({ offer = false, alsoBreakfast = false } = {}) {
  const id = stay(2);
  db.prepare("UPDATE reservations SET platform = 'Booking' WHERE id = ?").run(id);
  ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true });
  ctrl.updatePayment({ params: { id: String(id) }, body: { balancePaid: true, balancePaidDate: todayIso() }, query: {}, user: { id: 1, role: 'admin' } }, respond());
  const now = new Date(`${addDaysToIsoDate(row(id).startDate, -3)}T12:00:00`);
  const asked = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quote = extraSale.quote(id, asked, { now, source: 'shop' });
  const sold = extraSale.sell(id, asked, { now, source: 'shop', paid: { amountCents: quote.totalCents, ref: 'p' }, orderRef: 'order:9' });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  if (alsoBreakfast) {
    const morning = [{ articleRef: `option:${breakfast}`, quantity: 1 }];
    const breakfastQuote = extraSale.quote(id, morning, { now, source: 'shop' });
    assert.equal(extraSale.sell(id, morning, { now, source: 'shop', paid: { amountCents: breakfastQuote.totalCents, ref: 'p2' }, orderRef: 'order:10' }).status, 200);
  }
  if (offer) {
    const line = extraSale.saleDetailOf(id, now).lines.find((l) => l.articleKey === `option:${beer}`);
    assert.equal(extraSale.changeLine(id, line.ref, { offered: true }, { now, forceOverpayment: true }).status, 200);
    assert.equal(owed(id), 3000);
  }
  reservationsModel.create(db).markCancelled(id, { reason: 'Annulation iCal approuvée' });
  return id;
}

const register = (id) => { const res = respond(); refundsController.list({ params: { id: String(id) } }, res); return res.body; };
const beerLine = (id) => register(id).refundableLines.find((l) => l.key === `opt:${beer}`);

test('S6-6 — the cancelled stay offers the card order on its own line, at what it collected', () => {
  const id = orderedBeer();
  const line = beerLine(id);
  assert.ok(line, JSON.stringify(register(id).refundableLines));
  assert.equal(line.refundableTtc, 30);
});

test('S6-1 — the order offered then the stay cancelled: refunding the line settles the obligation; deleting the refund reopens it', () => {
  const id = orderedBeer({ offer: true });
  const line = beerLine(id);
  assert.ok(line && line.refundableTtc >= 30, JSON.stringify(register(id).refundableLines));
  const res = respond();
  refundsController.create({ params: { id: String(id) }, body: { refundDate: todayIso(), method: 'card', reason: 'Annulation', lines: [{ key: line.key, amountTtc: 30 }] } }, res);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(owed(id), 0);
  const gone = respond();
  refundsController.remove({ params: { id: String(id), refundId: String(res.body.refund.id) } }, gone);
  assert.equal(gone.statusCode, 200, JSON.stringify(gone.body));
  assert.equal(owed(id), 3000, 'a deleted refund gives the obligation back');
});

// Loop t7 D7-2 — the refund settles the obligation of the line it gives money back on, never another's.
test('D7-2 — two card orders, the beer offered then the stay cancelled: a refund on the BREAKFAST settles nothing; the beer\'s refund settles its 30 €', () => {
  const id = orderedBeer({ offer: true, alsoBreakfast: true });
  assert.equal(owed(id), 3000);
  const breakfastLine = register(id).refundableLines.find((l) => l.key === `opt:${breakfast}`);
  assert.ok(breakfastLine && breakfastLine.refundableTtc > 0, JSON.stringify(register(id).refundableLines));
  const onBreakfast = respond();
  refundsController.create({ params: { id: String(id) }, body: { refundDate: todayIso(), method: 'card', reason: 'Annulation', lines: [{ key: breakfastLine.key, amountTtc: breakfastLine.refundableTtc }] } }, onBreakfast);
  assert.equal(onBreakfast.statusCode, 201, JSON.stringify(onBreakfast.body));
  assert.equal(owed(id), 3000, 'the beer is still owed back');
  const onBeer = respond();
  refundsController.create({ params: { id: String(id) }, body: { refundDate: todayIso(), method: 'card', reason: 'Annulation', lines: [{ key: beerLine(id).key, amountTtc: 30 }] } }, onBeer);
  assert.equal(onBeer.statusCode, 201, JSON.stringify(onBeer.body));
  assert.equal(owed(id), 0);
  assert.deepEqual(db.prepare("SELECT lineRef, amountCents, settledBy FROM refund_obligations WHERE reservationId = ? AND status = 'settled'").all(id),
    [{ lineRef: `opt:${beer}`, amountCents: 3000, settledBy: `refund:${onBeer.body.refund.id}` }]);
  const gone = respond();
  refundsController.remove({ params: { id: String(id), refundId: String(onBeer.body.refund.id) } }, gone);
  assert.equal(gone.statusCode, 200, JSON.stringify(gone.body));
  assert.equal(owed(id), 3000, 'deleted, the beer\'s refund reopens its obligation');
});

test('S6-6 — when the budget is short, an arrival line a note paid is not the first capped: the accommodation gives way, not the order', () => {
  const { buildRefundableLines } = require('../utils/refunds');
  const base = {
    finalPrice: 545, touristTaxTotal: 0, vatRate: 10, nights: 2,
    options: [{ optionId: 12, title: 'Animation', totalPrice: 45, unitPrice: 45, quantity: 1, inComplement: 1, offered: 0 }],
    cancelled: { collectedTtc: 500, saleLeftTtc: 500, indemnityLeftTtc: 0, cashLeftTtc: 0 },
    collected: { accommodation: 500, 'opt:12': 45 },
  };
  const read = (extra) => buildRefundableLines({ ...base, ...extra }).map((l) => [l.key, l.refundableTtc]);
  assert.deepEqual(read({}), [['accommodation', 500]], 'an arrival line nobody collected is capped first');
  assert.deepEqual(read({ notePaidKeys: new Set(['opt:12']) }), [['accommodation', 455], ['opt:12', 45]]);
});
