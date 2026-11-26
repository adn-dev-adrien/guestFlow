// specs/pricing/pricing-components.md §3 rule 23 and rule 106 (stabilisation loop t6, UI6-5 / D6-2, 2026-11-16) — a paid line lowered on a
// PLATFORM stay opens the `lineLowered` obligation (rule 105, loop t5 A5-1) while the stay's trop-perçu reads 0: the fiche shows that
// money as its « Trop-perçu » row with « Rembourser », the refund dialog opens pre-filled with it, the refund is accepted and settles the
// obligation, and the row goes. Before: no row, a prefill of 0 and a 409 « Le trop-perçu est déjà remboursé. ». Loop t6 B6-2 — money a cash
// note took (caisse interne, off the books) is given back from the caisse interne by default, so its refund books no avoir; a card note's is not.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refundsController = require('../controllers/refundsController');
const { storedBody } = require('../utils/stayOrderLines');

const ADMIN = { id: 1, role: 'admin' };
const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const patch = (id, body) => ctrl.updatePayment({ params: { id: String(id) }, body, query: {}, user: ADMIN }, respond());
const view = (id) => { const res = respond(); ctrl.getById({ params: { id: String(id) }, query: {}, user: ADMIN }, res); return res.body; };
const open = (id) => db.prepare("SELECT id, amountCents, status, settledBy FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered'").all(id);

// A started stay, solde paid, 30 € of beer paid cash at the door, then offered (the operator confirmed the trop-perçu).
function offeredBeer(platform, payment = 'cash') {
  const id = stay(20);
  if (platform !== 'direct') db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
  ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true });
  patch(id, { balancePaid: true, balancePaidDate: todayIso() });
  patch(id, { checkInDone: true });
  const sold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at(id, '12:00', 1), payment });
  const ref = sold.saleDetail.lines.find((l) => l.articleKey === `option:${beer}`).ref;
  const asked = extraSale.changeLine(id, ref, { offered: true }, { now: at(id, '12:30', 1) });
  assert.deepEqual([asked.status, asked.body.code, asked.body.overpaymentTtc], [409, 'OVERPAID', 30]);
  const offered = extraSale.changeLine(id, ref, { offered: true }, { now: at(id, '12:30', 1), forceOverpayment: true });
  assert.equal(offered.status, 200, JSON.stringify(offered.body));
  return { id, askedMethod: asked.body.overpaymentMethod };
}

for (const [platform, payment, means] of [['direct', 'cash', 'internal'], ['Booking', 'cash', 'internal'], ['Booking', 'card', null]]) {
  test(`rule 106 — ${platform}, ${payment} note: the owed 30 € is the fiche's « Trop-perçu » row, pre-filled, refunded, and the obligation settles`, () => {
    const { id, askedMethod } = offeredBeer(platform, payment);
    assert.equal(askedMethod, means, 'the confirmation names the default means');
    assert.deepEqual(open(id).map((o) => [o.amountCents, o.status]), [[3000, 'open']]);
    const over = view(id).ledger.rows.find((r) => r.key === 'overpayment');
    assert.ok(over, 'the owed money has a row');
    assert.deepEqual([over.amount, over.stateLabel, over.action && over.action.kind, over.refundPrefill.overpaymentTtc], [30, 'À rembourser', 'refund', 30]);
    assert.equal(over.refundPrefill.method, means, 'cash note money goes back from the caisse interne');
    assert.equal(view(id).ledger.rows.filter((r) => String(r.key).startsWith('obligation-')).length, 0, 'one face for the same money');

    const res = respond();
    refundsController.create({ params: { id: String(id) }, body: {
      refundDate: todayIso(), method: over.refundPrefill.method || 'card', reason: 'Bière offerte', fromOverpayment: true, overpaymentTtc: 30,
      lines: [{ label: 'Trop-perçu', bucket: 'accommodation', amountTtc: 30 }],
    } }, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.deepEqual(open(id).map((o) => [o.status, o.settledBy]), [['settled', `refund:${res.body.refund.id}`]]);
    assert.equal(res.body.refund.method, over.refundPrefill.method || 'card');
    assert.equal(view(id).ledger.rows.some((r) => r.key === 'overpayment'), false, 'nothing is owed any more');

    const twice = respond();
    refundsController.create({ params: { id: String(id) }, body: {
      refundDate: todayIso(), method: 'internal', reason: 'x', fromOverpayment: true, overpaymentTtc: 30,
      lines: [{ label: 'Trop-perçu', bucket: 'accommodation', amountTtc: 30 }],
    } }, twice);
    assert.equal(twice.statusCode, 409, 'the same money is never given back twice');
  });
}
