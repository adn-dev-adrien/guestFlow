// specs/pricing-components.md §3 rules 23, 104, 105, 107 (stabilisation loop t6, D6-1, 2026-11-16) — the obligation a confirmed lowering of a paid line
// opens is the note money received beyond the total MINUS what a refund on the trop-perçu already gave back. Before: `noteExcessCents` measured the
// notes and the buckets, which still count the refunded money as received, so a second paid line offered after a refund opened 90 € owed while the
// trop-perçu read 60 € — the register asked to give the first 30 € back a second time.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, breakfast, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refunds = require('../controllers/refundsController');
const paidLineJudgment = require('../utils/paidLineJudgment');
const { storedBody } = require('../utils/stayOrderLines');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const cents = (v) => Math.round(Number(v || 0) * 100);
const notes = (id) => JSON.parse(row(id).midStaySettledNotes || '[]').reduce((sum, note) => sum + cents(note.total), 0);
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
const refunded = (id) => cents(db.prepare('SELECT COALESCE(SUM(totalTtc), 0) AS t FROM reservation_refunds WHERE reservationId = ?').get(id).t);
// Σ (acompte, solde, complements, notes) − open refund owed − refunds made − (price + tax): 0 while every cent received is in a bucket, owed or given back.
const balanced = (id) => {
  const r = row(id);
  return cents(r.depositAmount) + cents(r.balanceAmount) + cents(r.complementAmount) + cents(r.endOfStayComplementAmount) + notes(id) - owed(id) - refunded(id)
    - cents(r.finalPrice) - cents(r.touristTaxTotal);
};
const call = (handler, id, body) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  handler({ params: { id: String(id) }, body, user: { id: 1, role: 'admin' } }, res);
  return res;
};
const offeredBody = (id, optionId) => {
  const body = storedBody(id);
  body.options = body.options.map((o) => (Number(o.optionId) === optionId ? { ...o, offered: true } : o));
  return body;
};

test('D6-1 — direct stay: a refunded lowering, then a second card-paid line offered (confirmed): owed = trop-perçu, never the refunded money again', () => {
  const id = stay(3);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(todayIso(), id);
  for (const [article, quantity, ref] of [[beer, 5, 'card-1'], [breakfast, 1, 'card-2']]) {
    const requests = [{ articleRef: `option:${article}`, quantity }];
    const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
    const sold = extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref }, orderRef: `order:${ref}` });
    assert.equal(sold.status, 200, JSON.stringify(sold.body));
  }
  assert.equal(balanced(id), 0);

  assert.equal(ctrl.performUpdate(id, { ...offeredBody(id, beer), forceOverpayment: true }, { now }).status, 200);
  assert.deepEqual([owed(id), balanced(id)], [3000, 0]);
  const made = call(refunds.create, id, { refundDate: todayIso(), method: 'transfer', fromOverpayment: true, overpaymentTtc: 30, lines: [{ amountTtc: 30, label: 'Trop-perçu' }] });
  assert.equal(made.statusCode, 201, JSON.stringify(made.body));
  assert.deepEqual([owed(id), refunded(id), paidLineJudgment.noteExcessCents(db, id), balanced(id)], [0, 3000, 0, 0]);

  assert.equal(ctrl.performUpdate(id, { ...offeredBody(id, breakfast), forceOverpayment: true }, { now }).status, 200);
  const overpayment = cents(ctrl.storedOverpayment(id).overpaymentTtc);
  assert.deepEqual([owed(id), overpayment, balanced(id)], [6000, 6000, 0], 'the open row equals the trop-perçu (B2-5)');

  assert.equal(ctrl.performUpdate(id, storedBody(id), { now }).status, 200);
  assert.deepEqual([owed(id), balanced(id)], [6000, 0], 'a plain save keeps what is owed');
});
