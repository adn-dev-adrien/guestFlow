// specs/pricing-components.md §3 rule 110 (stabilisation loop t7, B7-1) — the note money no line claims (rule 104's credit, `unclaimed` /
// `noteCredit`) is counted less what a refund on the trop-perçu already gave back (the settled `lineLowered` rows, the subtraction
// `paidLineJudgment.noteExcessCents` makes). A note line offered, its trop-perçu refunded, then a new unpaid line: the new line is asked in full
// at the departure — direct and Booking, the note paid by card or in cash. Σ received net + still asked = the stay's total. A refund deleted
// reopens its obligation: the money is credit again, it pays the new line first (rule 115) and Σ received − owed + asked = total still holds.
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
const { lessRefundedCredit } = require('../utils/pricing/settlement');

const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const call = (handler, params, body) => { const res = respond(); handler({ params, body, query: {}, user: { id: 1, role: 'admin' } }, res); return res; };
const cents = (v) => Math.round(Number(v || 0) * 100);
const ledgerOf = (id) => call(ctrl.getById, { id }, undefined).body.ledger;

function offeredAndRefunded(platform, payment) {
  const id = stay(20);
  db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
  ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true });
  call(ctrl.updatePayment, { id: String(id) }, { balancePaid: true, balancePaidDate: todayIso() });
  call(ctrl.updatePayment, { id: String(id) }, { checkInDone: true });
  const at = (t) => new Date(`${addDaysToIsoDate(row(id).startDate, 1)}T${t}:00`);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at('12:00'), payment }).status, 200);
  const ref = extraSale.saleDetailOf(id, at('13:00')).lines.find((l) => l.articleKey === `option:${beer}`).ref;
  assert.equal(extraSale.changeLine(id, ref, { offered: true }, { now: at('13:00'), forceOverpayment: true }).status, 200);
  const over = ctrl.storedOverpayment(id);
  const made = call(refunds.create, { id: String(id) }, {
    refundDate: todayIso(), method: over.overpaymentMethod || 'transfer', reason: 'Trop-perçu', fromOverpayment: true, overpaymentTtc: over.overpaymentTtc,
    lines: over.overpaymentLines.map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amountTtc: l.amountTtc })),
  });
  assert.equal(made.statusCode, 201, JSON.stringify(made.body));
  return { id, at, refundId: made.body.refund.id };
}

test('B7-1 — lessRefundedCredit: the credit less the refund, gone at 0, never below', () => {
  const split = { total: 0, unclaimed: 30, unclaimedLabels: ['Bière'] };
  assert.equal(lessRefundedCredit(split, 0), split);
  assert.equal(lessRefundedCredit(split, 10).unclaimed, 20);
  assert.deepEqual(lessRefundedCredit(split, 30), { total: 0 });
  assert.deepEqual(lessRefundedCredit(split, 45), { total: 0 });
  assert.deepEqual(lessRefundedCredit({ total: 0 }, 30), { total: 0 });
});

for (const platform of ['direct', 'Booking']) {
  for (const payment of ['card', 'cash']) {
    test(`B7-1 — ${platform}, note by ${payment}: offered, refunded, then a 20 € line sold unpaid is asked in full at the departure`, () => {
      const { id, at } = offeredAndRefunded(platform, payment);
      assert.equal(ledgerOf(id).remaining, 0);
      assert.equal(extraSale.sell(id, [{ articleRef: `option:${plank}`, quantity: 1 }], { now: at('14:00') }).status, 200);
      const r = row(id);
      assert.equal(cents(r.finalPrice), 32000);
      const ledger = ledgerOf(id);
      assert.equal(ledger.remaining, 20);
      assert.deepEqual(ledger.rows.filter((x) => x.key === 'endOfStayComplement').map((x) => [x.amount, x.stateLabel]), [[20, 'À percevoir au départ']]);
      assert.equal(extraSale.saleDetailOf(id, at('15:00')).totals.dueCents, 2000);
      // Received net (solde 300 + note 30 − refund 30) + still asked 20 = the stay's total 320.
      assert.equal(30000 + 3000 - 3000 + 2000, cents(r.finalPrice) + cents(r.touristTaxTotal));
    });
  }
}

// Rule 115 (loop t8 S8-3) — the reopened money is credit again: it pays the 20 € line first, only the rest is owed back (refund-deleted-note-credit).
test('B7-1 — direct: the refund deleted after the new line, the obligation reopens and pays the new line first', () => {
  const { id, at, refundId } = offeredAndRefunded('direct', 'card');
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${plank}`, quantity: 1 }], { now: at('14:00') }).status, 200);
  assert.equal(ledgerOf(id).remaining, 20);
  const gone = respond();
  refunds.remove({ params: { id: String(id), refundId: String(refundId) }, query: {}, user: { id: 1, role: 'admin' } }, gone);
  assert.equal(gone.statusCode, 200, JSON.stringify(gone.body));
  const owed = Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
  assert.equal(owed, 1000);
  assert.equal(ledgerOf(id).remaining, 0);
  assert.equal(30000 + 3000 - owed, cents(row(id).finalPrice) + cents(row(id).touristTaxTotal));
});
