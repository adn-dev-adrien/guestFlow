// specs/pricing-components.md §3 rule 119 (stabilisation loop t8, S8-3, 2026-11-16) — a refund on the trop-perçu deleted gives its money back to
// the stay, and that money is rule 104's credit again: it pays what the stay still asks first, only the rest is owed back. A note line offered,
// its 30 € refunded, then « refund deleted, new 20 € line sold » or « new line sold, refund deleted »: both orders end on the same stay — the
// new line paid by the credit, 10 € owed back, Σ received − owed + asked = total. Before, the second order left 30 € owed AND the 20 € asked.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');

const plank = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Planche ronde', 20, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) SELECT propertyId, ? FROM property_options WHERE optionId = ? LIMIT 1').run(plank, beer);
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refunds = require('../controllers/refundsController');
const { storedBody } = require('../utils/stayOrderLines');

const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const call = (handler, params, body) => { const res = respond(); handler({ params, body, query: {}, user: { id: 1, role: 'admin' } }, res); return res; };
const cents = (v) => Math.round(Number(v || 0) * 100);
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
const refunded = (id) => cents(db.prepare('SELECT COALESCE(SUM(totalTtc), 0) AS s FROM reservation_refunds WHERE reservationId = ?').get(id).s);
const notes = (id) => JSON.parse(row(id).midStaySettledNotes || '[]').reduce((sum, note) => sum + cents(note.total), 0);
const BUCKETS = ['depositAmount', 'balanceAmount', 'complementAmount', 'endOfStayComplementAmount'];
const state = (id) => {
  const r = row(id);
  return { owed: owed(id), finalPrice: cents(r.finalPrice), ...Object.fromEntries(BUCKETS.map((b) => [b, cents(r[b])])) };
};
// Σ buckets + notes − refunds − owed − (price + tax): what the stay received or asks beyond its total. Constant through every gesture.
const gap = (id) => {
  const r = row(id);
  return BUCKETS.reduce((sum, b) => sum + cents(r[b]), notes(id)) - refunded(id) - owed(id) - cents(r.finalPrice) - cents(r.touristTaxTotal);
};

// The beer ordered in the app and paid (30 €), offered (forced: nothing absorbs it), its trop-perçu refunded. `day` = days after the arrival.
function offeredAndRefunded(platform, { day }) {
  const id = stay(-day); // the gestures happen today
  db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
  ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true });
  call(ctrl.updatePayment, { id: String(id) }, { balancePaid: true, balancePaidDate: todayIso() });
  if (day >= 0) call(ctrl.updatePayment, { id: String(id) }, { checkInDone: true });
  const at = (t) => new Date(`${addDaysToIsoDate(row(id).startDate, day)}T${t}:00`);
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  // Before the arrival the guest orders in the app and pays online; during the stay the reception takes the card.
  const paid = day < 0
    ? extraSale.sell(id, requests, { now: at('12:00'), source: 'shop', paid: { amountCents: extraSale.quote(id, requests, { now: at('12:00'), source: 'shop' }).totalCents, ref: 'card-1' }, orderRef: 'order:1' })
    : extraSale.sell(id, requests, { now: at('12:00'), payment: 'card' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const ref = extraSale.saleDetailOf(id, at('13:00')).lines.find((l) => l.articleKey === `option:${beer}`).ref;
  assert.equal(extraSale.changeLine(id, ref, { offered: true }, { now: at('13:00'), forceOverpayment: true }).status, 200);
  assert.equal(owed(id), 3000);
  const over = ctrl.storedOverpayment(id);
  const made = call(refunds.create, { id: String(id) }, {
    refundDate: todayIso(), method: over.overpaymentMethod || 'transfer', reason: 'Trop-perçu', fromOverpayment: true, overpaymentTtc: over.overpaymentTtc,
    lines: over.overpaymentLines.map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amountTtc: l.amountTtc })),
  });
  assert.equal(made.statusCode, 201, JSON.stringify(made.body));
  assert.equal(owed(id), 0);
  return { id, at, refundId: made.body.refund.id };
}

const sellPlank = (id, at) => assert.equal(extraSale.sell(id, [{ articleRef: `option:${plank}`, quantity: 1 }], { now: at('14:00') }).status, 200);
const deleteRefund = (id, refundId) => {
  const gone = respond();
  refunds.remove({ params: { id: String(id), refundId: String(refundId) }, query: {}, user: { id: 1, role: 'admin' } }, gone);
  assert.equal(gone.statusCode, 200, JSON.stringify(gone.body));
};

for (const platform of ['direct', 'Booking']) {
  test(`S8-3 — ${platform}, during the stay: « refund deleted, line sold » and « line sold, refund deleted » end the same — the line paid by the credit, 10 € owed`, () => {
    const first = offeredAndRefunded(platform, { day: 1 });
    const gapFirst = gap(first.id);
    deleteRefund(first.id, first.refundId);
    sellPlank(first.id, first.at);

    const second = offeredAndRefunded(platform, { day: 1 });
    const gapSecond = gap(second.id);
    sellPlank(second.id, second.at);
    assert.equal(cents(row(second.id).endOfStayComplementAmount), 2000, 'refunded money is no credit: the line is asked (rule 110)');
    deleteRefund(second.id, second.refundId);

    assert.deepEqual(state(second.id), state(first.id));
    assert.deepEqual([owed(second.id), cents(row(second.id).endOfStayComplementAmount)], [1000, 0], 'the credit pays the 20 € line, 10 € owed back');
    assert.deepEqual([gap(first.id), gap(second.id)], [gapFirst, gapSecond], 'nothing lost, nothing made');
  });
}

test('S8-3 — direct, before the arrival: the refund deleted after the sale credits the open arrival complement as the sale would have', () => {
  const first = offeredAndRefunded('direct', { day: -3 });
  deleteRefund(first.id, first.refundId);
  sellPlank(first.id, first.at);

  const second = offeredAndRefunded('direct', { day: -3 });
  const before = gap(second.id);
  sellPlank(second.id, second.at);
  deleteRefund(second.id, second.refundId);

  assert.deepEqual(state(second.id), state(first.id));
  assert.equal(owed(second.id), 1000);
  assert.equal(gap(second.id), before);
});

test('S8-3 — a refund deleted with nothing left to pay: the whole money is owed back again', () => {
  const { id, refundId } = offeredAndRefunded('direct', { day: 1 });
  const before = { ...state(id), gap: gap(id) };
  deleteRefund(id, refundId);
  assert.deepEqual({ ...state(id), gap: gap(id) }, { ...before, owed: 3000 });
});
