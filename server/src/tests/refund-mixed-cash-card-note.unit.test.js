// specs/pricing/pricing-components.md §3 rule 112 (stabilisation loop t7, B7-3) — a trop-perçu made of a cash note AND a card note: the fiche serves the
// cash part apart (`overpaymentCash`, the ledger's `refundPrefill.cashPart`), the refund dialog opens on it « Caisse interne », and once it is
// given back the rest defaults to the means it came by (`cashNoteExcessCents` deducts the cash a caisse-interne refund settled). The avoir covers
// only the booked money.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');

const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refunds = require('../controllers/refundsController');
const { storedBody } = require('../utils/stayOrderLines');
const { cashPartOf } = require('../utils/overpayment');

const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const call = (handler, params, body) => { const res = respond(); handler({ params, body, query: {}, user: { id: 1, role: 'admin' } }, res); return res; };
const booked = (id) => db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM payment_allocations WHERE documentRef = ? AND kind = 'refund' AND books = 1")
  .get(`reservation:${id}`);

test('B7-3 — cashPartOf: the cash part carved from the prestations first; none when nothing or everything is cash', () => {
  const lines = [{ bucket: 'accommodation', label: 'Hébergement', amountTtc: 10 }, { bucket: 'options', label: 'Prestations complémentaires', amountTtc: 50 }];
  assert.deepEqual(cashPartOf(lines, 60, 3000), { amountTtc: 30, restTtc: 30, lines: [{ bucket: 'options', label: 'Prestations complémentaires', amountTtc: 30 }] });
  assert.deepEqual(cashPartOf(lines, 60, 5500).lines.map((l) => [l.bucket, l.amountTtc]), [['options', 50], ['accommodation', 5]]);
  assert.equal(cashPartOf(lines, 60, 0), null);
  assert.equal(cashPartOf(lines, 60, 6000), null);
});

for (const platform of ['direct', 'Booking']) {
  test(`B7-3 — ${platform}: cash 30 + card 30 offered — 30 proposed « Caisse interne », then 30 by the booked means; one avoir of 30`, () => {
    const id = stay(20);
    db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
    ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true });
    call(ctrl.updatePayment, { id: String(id) }, { balancePaid: true, balancePaidDate: todayIso() });
    call(ctrl.updatePayment, { id: String(id) }, { checkInDone: true });
    const at = (t) => new Date(`${addDaysToIsoDate(row(id).startDate, 1)}T${t}:00`);
    assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at('12:00'), payment: 'cash' }).status, 200);
    assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at('13:00'), payment: 'card' }).status, 200);
    for (const line of extraSale.saleDetailOf(id, at('14:00')).lines.filter((l) => l.articleKey === `option:${beer}`)) {
      assert.equal(extraSale.changeLine(id, line.ref, { offered: true }, { now: at('14:00'), forceOverpayment: true }).status, 200);
    }
    const first = ctrl.storedOverpayment(id);
    assert.equal(first.overpaymentTtc, 60);
    assert.equal(first.overpaymentMethod, null);
    assert.deepEqual(first.overpaymentCash, { amountTtc: 30, restTtc: 30, lines: [{ bucket: 'options', label: 'Prestations complémentaires', amountTtc: 30 }] });
    const prefill = call(ctrl.getById, { id }, undefined).body.ledger.rows.find((r) => r.key === 'overpayment').refundPrefill;
    assert.deepEqual(prefill.cashPart, first.overpaymentCash);
    const cash = call(refunds.create, { id: String(id) }, {
      refundDate: todayIso(), method: 'internal', reason: 'Trop-perçu', fromOverpayment: true, overpaymentTtc: first.overpaymentTtc,
      lines: first.overpaymentCash.lines.map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amountTtc: l.amountTtc })),
    });
    assert.equal(cash.statusCode, 201, JSON.stringify(cash.body));
    const second = ctrl.storedOverpayment(id);
    assert.equal(second.overpaymentTtc, 30);
    assert.equal(second.overpaymentMethod, null, 'the card money goes back by the booked means, not the till');
    assert.equal(second.overpaymentCash, undefined);
    const card = call(refunds.create, { id: String(id) }, {
      refundDate: todayIso(), method: 'transfer', reason: 'Trop-perçu', fromOverpayment: true, overpaymentTtc: second.overpaymentTtc,
      lines: second.overpaymentLines.map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amountTtc: l.amountTtc })),
    });
    assert.equal(card.statusCode, 201, JSON.stringify(card.body));
    assert.equal(ctrl.storedOverpayment(id).overpaymentTtc, 0);
    assert.equal(booked(id).c, -3000, 'only the card money is reversed in the books');
  });
}
