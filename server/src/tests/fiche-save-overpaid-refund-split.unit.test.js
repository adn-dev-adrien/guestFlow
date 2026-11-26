// specs/pricing/pricing-components.md §3 rule 113 (stabilisation loop t8, UI8-1 / UI8-2) — the 409 OVERPAID a fiche save answers carries the split the
// ledger row's `refundPrefill` serves once the save is confirmed: lines by poste, means, and the cash part (`overpaymentCash`, rule 112) — on a
// platform stay too, whose refusal comes from the paid-line judgment (rule 104). The refund dialog replayed on that body (its cash part
// « Caisse interne » first, then the rest by the booked means) books one avoir on 70600010, and only on the booked money.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');

const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refunds = require('../controllers/refundsController');
const { storedBody } = require('../utils/stayOrderLines');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const { create: createAccountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { create: createAccountingController } = optionalPlugin(() => require('../plugins/accounting-export/controller'));
const BOOKS = { skip: skipWithout(['accounting-export']) };

const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const call = (handler, params, body) => { const res = respond(); handler({ params, body, query: {}, user: { id: 1, role: 'admin' } }, res); return res; };
const booked = (id) => db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM payment_allocations WHERE documentRef = ? AND kind = 'refund' AND books = 1")
  .get(`reservation:${id}`).c;
const OPTIONS = { bucket: 'options', label: 'Prestations complémentaires' };

function refundAccounts(id) {
  const out = new Set();
  for (const day of [todayIso(), addDaysToIsoDate(row(id).startDate, 1)]) {
    const [y, m] = day.split('-').map(Number);
    let answer = null;
    const res = { setHeader() {}, status() { return res; }, json(b) { answer = b; return res; } };
    createAccountingController(createAccountingModel(db)).salesJson({ query: { year: y, month: m } }, res);
    for (const e of (answer.entries || []).filter((x) => x.reservationId === id && x.kind === 'refund')) {
      for (const l of e.lines) if (/^706/.test(String(l.compte))) out.add(`${l.compte}:${l.debit || 0}/${l.credit || 0}`);
    }
  }
  return [...out].sort();
}

// A paid stay whose guest bought beer during the stay (one note per means), then the beer offered in the fiche: the save answers 409.
function offeredInTheFiche(platform, means) {
  const id = stay(20);
  db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
  ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true });
  call(ctrl.updatePayment, { id: String(id) }, { balancePaid: true, balancePaidDate: todayIso() });
  call(ctrl.updatePayment, { id: String(id) }, { checkInDone: true });
  const at = (t) => new Date(`${addDaysToIsoDate(row(id).startDate, 1)}T${t}:00`);
  means.forEach((payment, i) => assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at(`1${2 + i}:00`), payment }).status, 200));
  const body = storedBody(id);
  const offered = { ...body, options: body.options.map((o) => (Number(o.optionId) === beer ? { ...o, offered: true } : o)) };
  const asked = ctrl.performUpdate(id, offered, { now: at('14:00') });
  assert.equal(asked.status, 409);
  assert.equal(asked.body.code, 'OVERPAID');
  assert.equal(ctrl.performUpdate(id, { ...offered, forceOverpayment: true }, { now: at('14:00') }).status, 200);
  const prefill = call(ctrl.getById, { id }, undefined).body.ledger.rows.find((r) => r.key === 'overpayment').refundPrefill;
  return { id, err: asked.body, prefill };
}

// What « Enregistrer et rembourser » posts untouched: the cash part « Caisse interne » first (rule 112), then the rest from the ledger row.
function refundAsTheDialog(id, err) {
  const post = (method, lines, overpaymentTtc = err.overpaymentTtc) => call(refunds.create, { id: String(id) }, {
    refundDate: todayIso(), method, reason: '', fromOverpayment: true, overpaymentTtc,
    lines: lines.map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amountTtc: l.amountTtc })),
  });
  if (err.overpaymentCash) {
    assert.equal(post('internal', err.overpaymentCash.lines).statusCode, 201);
    const rest = ctrl.storedOverpayment(id);
    assert.equal(rest.overpaymentTtc, err.overpaymentCash.restTtc);
    assert.equal(post(rest.overpaymentMethod || 'transfer', rest.overpaymentLines, rest.overpaymentTtc).statusCode, 201);
  } else {
    assert.equal(post(err.overpaymentMethod || 'transfer', err.overpaymentLines).statusCode, 201);
  }
}

for (const platform of ['direct', 'Booking']) {
  test(`UI8-2 — ${platform}: a card note line offered in the fiche — the 409 splits the trop-perçu on « Prestations complémentaires »`, () => {
    const { err, prefill } = offeredInTheFiche(platform, ['card']);
    assert.equal(err.overpaymentTtc, 30);
    assert.deepEqual(err.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['options', 30]]);
    assert.equal(err.overpaymentMethod, prefill.method);
    assert.equal(err.overpaymentCash, undefined);
  });

  test(`UI8-1 / UI8-2 — ${platform}: cash 30 + card 30 offered in the fiche — the 409 carries the cash part the ledger row serves`, () => {
    const { err, prefill } = offeredInTheFiche(platform, ['cash', 'card']);
    assert.equal(err.overpaymentTtc, 60);
    assert.deepEqual(err.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['options', 60]]);
    assert.equal(err.overpaymentMethod, null);
    assert.deepEqual(err.overpaymentCash, { amountTtc: 30, restTtc: 30, lines: [{ ...OPTIONS, amountTtc: 30 }] });
    assert.deepEqual(err.overpaymentCash, prefill.cashPart);
  });

  test(`UI8-2 — ${platform}: a cash note line offered in the fiche — the 409 still defaults to the caisse interne (rule 106 b)`, () => {
    const { err } = offeredInTheFiche(platform, ['cash']);
    assert.equal(err.overpaymentMethod, 'internal');
    assert.deepEqual(err.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['options', 30]]);
  });

  for (const means of [['card'], ['cash', 'card']]) {
    test(`UI8-1 / UI8-2 — ${platform} ${means.join(' + ')}: the dialog replayed on the 409 books one avoir on 70600010, on the booked money only`, BOOKS, () => {
      const { id, err } = offeredInTheFiche(platform, means);
      refundAsTheDialog(id, err);
      assert.equal(ctrl.storedOverpayment(id).overpaymentTtc, 0);
      assert.deepEqual(refundAccounts(id), ['70600010:27.27/0']);
      assert.equal(booked(id), -3000);
    });
  }
}
