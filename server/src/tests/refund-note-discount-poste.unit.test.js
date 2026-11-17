// specs/pricing-components.md §3 rule 111, reading of 2026-11-16 (stabilisation loop t8, B8-1) — a note line DISCOUNTED leaves its money on its
// own poste, as an offered one does: `postesLeft` measures what a stored line charges as its amount less its own discount (`discountCents`), so a
// card note's beer 30 discounted 24 reads « Prestations complémentaires » 24 and its avoir reverses 70600010, the account the note booked —
// never « Hébergement » / 70600000. Direct and Booking, card; a cash note's discount defaults to the caisse interne on the same poste.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');

const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refunds = require('../controllers/refundsController');
const { storedBody } = require('../utils/stayOrderLines');
const { postesLeft } = require('../models/refundInputModel');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const { create: createAccountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { create: createAccountingController } = optionalPlugin(() => require('../plugins/accounting-export/controller'));
const BOOKS = { skip: skipWithout(['accounting-export']) };

const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const call = (handler, params, body) => { const res = respond(); handler({ params, body, query: {}, user: { id: 1, role: 'admin' } }, res); return res; };

function journal(id) {
  const out = [];
  for (const day of [todayIso(), addDaysToIsoDate(row(id).startDate, 1)]) {
    const [y, m] = day.split('-').map(Number);
    let answer = null;
    const res = { setHeader() {}, status() { return res; }, json(b) { answer = b; return res; } };
    createAccountingController(createAccountingModel(db)).salesJson({ query: { year: y, month: m } }, res);
    for (const e of (answer.entries || []).filter((x) => x.reservationId === id)) if (!out.some((o) => o.id === e.id && o.kind === e.kind)) out.push(e);
  }
  return out;
}

function discountedNoteLine(platform, payment) {
  const id = stay(20);
  db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
  ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true });
  call(ctrl.updatePayment, { id: String(id) }, { balancePaid: true, balancePaidDate: todayIso() });
  call(ctrl.updatePayment, { id: String(id) }, { checkInDone: true });
  const at = (t) => new Date(`${addDaysToIsoDate(row(id).startDate, 1)}T${t}:00`);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at('12:00'), payment }).status, 200);
  const ref = extraSale.saleDetailOf(id, at('13:00')).lines.find((l) => l.articleKey === `option:${beer}`).ref;
  const asked = extraSale.changeLine(id, ref, { discount: { amount: 24 } }, { now: at('13:00') });
  assert.equal(asked.status, 409);
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 24 } }, { now: at('13:00'), forceOverpayment: true }).status, 200);
  return id;
}

for (const platform of ['direct', 'Booking']) {
  test(`B8-1 — ${platform}: a card note line discounted 24 — « Prestations complémentaires » 24, its avoir on 70600010`, BOOKS, () => {
    const id = discountedNoteLine(platform, 'card');
    assert.deepEqual(postesLeft(db, id, { scope: 'schedule' }), { options: 24, resources: 0, touristTax: 0 });
    const over = ctrl.storedOverpayment(id);
    assert.deepEqual(over.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['options', 24]]);
    const prefill = call(ctrl.getById, { id }, undefined).body.ledger.rows.find((r) => r.key === 'overpayment').refundPrefill;
    assert.deepEqual(prefill.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['options', 24]]);
    const made = call(refunds.create, { id: String(id) }, {
      refundDate: todayIso(), method: 'transfer', reason: 'Trop-perçu', fromOverpayment: true, overpaymentTtc: over.overpaymentTtc,
      lines: over.overpaymentLines.map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amountTtc: l.amountTtc })),
    });
    assert.equal(made.statusCode, 201, JSON.stringify(made.body));
    const accountsOf = (kind) => journal(id).filter((e) => e.kind === kind).flatMap((e) => e.lines.map((l) => String(l.compte))).filter((c) => /^706/.test(c));
    assert.deepEqual(accountsOf('midStayComplement'), ['70600010']);
    assert.deepEqual(accountsOf('refund'), ['70600010']);
  });
}

test('B8-1 — direct, cash note discounted: « Prestations complémentaires » 24 through the caisse interne', () => {
  const id = discountedNoteLine('direct', 'cash');
  const over = ctrl.storedOverpayment(id);
  assert.equal(over.overpaymentMethod, 'internal');
  assert.deepEqual(over.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['options', 24]]);
});
