// specs/pricing/pricing-components.md §3 rule 111 (stabilisation loop t7, B7-2) — the trop-perçu of note money is split on the poste of the line the note
// paid (`postesLeft` reads the notes register by line key: a note's allocation loses its line once the line is offered), so the refund dialog
// pre-fills « Prestations complémentaires » and the avoir reverses 70600010, the account that booked the sale — never « Hébergement ».
// Loop t8 D8-1 (reservation-refunds rule 49 reading of 2026-11-16) — once the stay is cancelled, that key-less refund is deducted from its own poste:
// refunding everything gives each poste back what it collected, options never above what the notes sold, « Hébergement » never below its money.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, breakfast, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');

const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refunds = require('../controllers/refundsController');
const reservations = require('../models/reservationsModel');
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

for (const platform of ['direct', 'Booking']) {
  test(`B7-2 — ${platform}: a card note line offered — the trop-perçu reads « Prestations complémentaires » and its avoir books 70600010`, BOOKS, () => {
    const id = stay(20);
    db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
    ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true });
    call(ctrl.updatePayment, { id: String(id) }, { balancePaid: true, balancePaidDate: todayIso() });
    call(ctrl.updatePayment, { id: String(id) }, { checkInDone: true });
    const at = (t) => new Date(`${addDaysToIsoDate(row(id).startDate, 1)}T${t}:00`);
    assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at('12:00'), payment: 'card' }).status, 200);
    const ref = extraSale.saleDetailOf(id, at('13:00')).lines.find((l) => l.articleKey === `option:${beer}`).ref;
    assert.equal(extraSale.changeLine(id, ref, { offered: true }, { now: at('13:00'), forceOverpayment: true }).status, 200);
    assert.deepEqual(postesLeft(db, id, { scope: 'schedule' }), { options: 30, resources: 0, touristTax: 0 });
    const over = ctrl.storedOverpayment(id);
    assert.deepEqual(over.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['options', 30]]);
    const prefill = call(ctrl.getById, { id }, undefined).body.ledger.rows.find((r) => r.key === 'overpayment').refundPrefill;
    assert.deepEqual(prefill.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['options', 30]]);
    const made = call(refunds.create, { id: String(id) }, {
      refundDate: todayIso(), method: 'transfer', reason: 'Trop-perçu', fromOverpayment: true, overpaymentTtc: over.overpaymentTtc,
      lines: over.overpaymentLines.map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amountTtc: l.amountTtc })),
    });
    assert.equal(made.statusCode, 201, JSON.stringify(made.body));
    const entries = journal(id);
    const accountsOf = (kind) => entries.filter((e) => e.kind === kind).flatMap((e) => e.lines.map((l) => String(l.compte))).filter((c) => /^706/.test(c));
    assert.deepEqual(accountsOf('midStayComplement'), ['70600010']);
    assert.deepEqual(accountsOf('refund'), ['70600010']);
  });
}

test('B7-2 — a note line still charged at its price leaves nothing on its poste', () => {
  const id = stay(20);
  ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true });
  call(ctrl.updatePayment, { id: String(id) }, { balancePaid: true, balancePaidDate: todayIso() });
  call(ctrl.updatePayment, { id: String(id) }, { checkInDone: true });
  const at = (t) => new Date(`${addDaysToIsoDate(row(id).startDate, 1)}T${t}:00`);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at('12:00'), payment: 'card' }).status, 200);
  assert.deepEqual(postesLeft(db, id, { scope: 'schedule' }), { options: 0, resources: 0, touristTax: 0 });
});

for (const platform of ['direct', 'Booking']) {
  test(`D8-1 — ${platform}: the trop-perçu refunded on « Prestations complémentaires », then the stay cancelled — each poste gives back what it collected`, () => {
    const id = stay(20);
    db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
    ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true });
    call(ctrl.updatePayment, { id: String(id) }, { balancePaid: true, balancePaidDate: todayIso() });
    call(ctrl.updatePayment, { id: String(id) }, { checkInDone: true });
    const at = (t) => new Date(`${addDaysToIsoDate(row(id).startDate, 1)}T${t}:00`);
    assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at('12:00'), payment: 'card' }).status, 200);
    assert.equal(extraSale.sell(id, [{ articleRef: `option:${breakfast}`, quantity: 1 }], { now: at('12:05'), payment: 'card' }).status, 200);
    const ref = extraSale.saleDetailOf(id, at('13:00')).lines.find((l) => l.articleKey === `option:${beer}`).ref;
    assert.equal(extraSale.changeLine(id, ref, { offered: true }, { now: at('13:00'), forceOverpayment: true }).status, 200);
    const over = ctrl.storedOverpayment(id);
    assert.deepEqual(over.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['options', 30]]);
    const made = call(refunds.create, { id: String(id) }, {
      refundDate: todayIso(), method: 'transfer', reason: 'Trop-perçu', fromOverpayment: true, overpaymentTtc: over.overpaymentTtc,
      lines: over.overpaymentLines.map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amountTtc: l.amountTtc })),
    });
    assert.equal(made.statusCode, 201, JSON.stringify(made.body));

    const cents = (v) => Math.round(Number(v || 0) * 100);
    const r = row(id);
    const notesCents = JSON.parse(r.midStaySettledNotes || '[]').reduce((sum, note) => sum + cents(note.total), 0);
    const planCents = cents(r.depositAmount) + cents(r.balanceAmount);
    assert.equal(notesCents, 9000);
    reservations.create(db).markCancelled(id, { reason: 'Annulation' });
    const register = call(refunds.list, { id: String(id) }).body;
    const offered = Object.fromEntries(register.refundableLines.map((l) => [l.key, cents(l.refundableTtc)]));
    assert.equal(offered[`opt:${beer}`] || 0, 0, 'the offered beer was given back by the trop-perçu refund');
    const all = call(refunds.create, { id: String(id) }, {
      refundDate: todayIso(), method: 'card', reason: 'Annulation',
      lines: register.refundableLines.map((l) => ({ key: l.key, amountTtc: l.refundableTtc })),
    });
    assert.equal(all.statusCode, 201, JSON.stringify(all.body));
    const byPoste = {};
    for (const l of db.prepare('SELECT l.bucket, l.revenueBucket, l.amountTtc FROM reservation_refund_lines l JOIN reservation_refunds f ON f.id = l.refundId WHERE f.reservationId = ?').all(id)) {
      const poste = l.revenueBucket || l.bucket;
      byPoste[poste] = (byPoste[poste] || 0) + cents(l.amountTtc);
    }
    assert.equal(byPoste.options, notesCents, 'options give back what the notes sold, no more');
    assert.equal((byPoste.accommodation || 0) + (byPoste.touristTax || 0), planCents, 'the plan postes give back what the plan collected, no less');
  });
}
