// specs/pricing-components.md §3 rule 114 (stabilisation loop t8, B8-5 OLD, B8-6) — a platform stay's arrival complement is money the
// ESTABLISHMENT collected: once collected (a link or a transfer before the arrival), each line it named claims what it collected on it
// (`complementPaidSplit.lines`), as a note does. A line of it offered, discounted or lowered is judged by the one paid-line judgment (rule
// 105): 409 OVERPAID (« Prestations complémentaires »), confirmed → a `lineLowered` obligation the ledger shows « À rembourser » and the
// refund dialog gives back on 70600010; removed → 409 LINE_PAID; put back → the obligation closes; refunded then put back → LINE_REFUNDED.
// Before, the line went to 0 and the establishment kept 30 € for nothing (also on master). And a line lowered before the arrival no longer
// makes every later sale of the stay fail its « sold at arrival » floor (B8-6): the floor is what the line held entering the save.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');

const plank = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Planche plateforme', 20, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9701, ?)').run(plank);
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refunds = require('../controllers/refundsController');
const { storedBody } = require('../utils/stayOrderLines');
const { arrivalExtrasViolations } = require('../utils/midStayExtrasWindow');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const { create: createAccountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { create: createAccountingController } = optionalPlugin(() => require('../plugins/accounting-export/controller'));
const BOOKS = { skip: skipWithout(['accounting-export']) };

const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const call = (handler, params, body) => { const res = respond(); handler({ params, body, query: {}, user: { id: 1, role: 'admin' } }, res); return res; };
const cents = (v) => Math.round(Number(v || 0) * 100);
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
const refundedCents = (id) => cents(db.prepare('SELECT COALESCE(SUM(totalTtc), 0) AS t FROM reservation_refunds WHERE reservationId = ?').get(id).t);
const notesCents = (id) => JSON.parse(row(id).midStaySettledNotes || '[]').reduce((sum, note) => sum + cents(note.total), 0);
const imbalance = (id) => {
  const r = row(id);
  return cents(r.depositAmount) + cents(r.balanceAmount) + cents(r.complementAmount) + cents(r.endOfStayComplementAmount) + notesCents(id)
    - owed(id) - refundedCents(id) - cents(r.finalPrice) - cents(r.touristTaxTotal);
};

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

// A Booking stay with a beer 30 in its arrival complement, the platform's solde and the complement collected before the arrival.
function collectedEarly({ cash = false } = {}) {
  const id = stay(20);
  db.prepare("UPDATE reservations SET platform = 'Booking' WHERE id = ?").run(id);
  const body = storedBody(id);
  body.options = [...(body.options || []), { optionId: beer, quantity: 5 }];
  ctrl.performUpdate(id, { ...body, restatePricing: true });
  assert.equal(call(ctrl.updatePayment, { id: String(id) }, { balancePaid: true, balancePaidDate: todayIso() }).statusCode, 200);
  const complement = cash ? { complementPaidCash: true, complementPaidDate: todayIso() } : { complementPaid: true, complementPaidDate: todayIso() };
  assert.equal(call(ctrl.updatePayment, { id: String(id) }, complement).statusCode, 200);
  assert.equal(cents(row(id).complementAmount), 3000);
  const pre = new Date(`${addDaysToIsoDate(row(id).startDate, -2)}T12:00:00`);
  const beerRef = () => extraSale.saleDetailOf(id, pre).lines.find((l) => l.articleKey === `option:${beer}`).ref;
  return { id, pre, beerRef };
}

const refundAsProposed = (id) => {
  const over = ctrl.storedOverpayment(id);
  const made = call(refunds.create, { id: String(id) }, {
    refundDate: todayIso(), method: over.overpaymentMethod || 'transfer', reason: 'Trop-perçu', fromOverpayment: true, overpaymentTtc: over.overpaymentTtc,
    lines: over.overpaymentLines.map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amountTtc: l.amountTtc })),
  });
  assert.equal(made.statusCode, 201, JSON.stringify(made.body));
};

for (const [gesture, want, freed] of [['offered', { offered: true }, 30], ['discounted 24', { discount: { amount: 24 } }, 24]]) {
  test(`B8-5 — Booking, complement collected, the beer ${gesture} before the arrival: 409 OVERPAID ${freed}, then owed and refunded on 70600010`, BOOKS, () => {
    const { id, pre, beerRef } = collectedEarly();
    const asked = extraSale.changeLine(id, beerRef(), want, { now: pre });
    assert.equal(asked.status, 409);
    assert.equal(asked.body.code, 'OVERPAID');
    assert.equal(asked.body.overpaymentTtc, freed);
    assert.equal(cents(row(id).finalPrice), 33000, 'nothing written');
    assert.equal(extraSale.changeLine(id, beerRef(), want, { now: pre, forceOverpayment: true }).status, 200);
    assert.equal(owed(id), freed * 100);
    const over = ctrl.storedOverpayment(id);
    assert.equal(over.overpaymentTtc, freed);
    assert.deepEqual(over.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['options', freed]]);
    const ledger = call(ctrl.getById, { id }, undefined).body.ledger;
    assert.deepEqual(ledger.rows.filter((x) => x.key === 'overpayment').map((x) => [x.amount, x.stateLabel]), [[freed, 'À rembourser']]);
    assert.equal(imbalance(id), 0);
    refundAsProposed(id);
    assert.equal(owed(id), 0);
    assert.equal(imbalance(id), 0);
    const accountsOf = (kind) => journal(id).filter((e) => e.kind === kind).flatMap((e) => e.lines.map((l) => String(l.compte))).filter((c) => /^706/.test(c));
    assert.deepEqual(accountsOf('complement'), ['70600010']);
    assert.deepEqual(accountsOf('refund'), ['70600010']);
  });
}

test('B8-5 — Booking, complement collected « caisse interne »: the refund defaults to the caisse interne', () => {
  const { id, pre, beerRef } = collectedEarly({ cash: true });
  assert.equal(extraSale.changeLine(id, beerRef(), { offered: true }, { now: pre, forceOverpayment: true }).status, 200);
  const over = ctrl.storedOverpayment(id);
  assert.equal(over.overpaymentTtc, 30);
  assert.equal(over.overpaymentMethod, 'internal');
});

test('B8-5 — Booking, complement collected: a line it collected can be offered, not removed (LINE_PAID)', () => {
  const { id, pre, beerRef } = collectedEarly();
  const removed = extraSale.removeLine(id, beerRef(), { now: pre });
  assert.equal(removed.status, 409);
  assert.equal(removed.body.code, 'LINE_PAID');
  assert.equal(cents(row(id).finalPrice), 33000);
});

test('B8-5 — Booking: the offer taken back closes the obligation; refunded first, it is refused (LINE_REFUNDED)', () => {
  const back = collectedEarly();
  assert.equal(extraSale.changeLine(back.id, back.beerRef(), { offered: true }, { now: back.pre, forceOverpayment: true }).status, 200);
  assert.equal(extraSale.changeLine(back.id, back.beerRef(), { offered: false }, { now: back.pre }).status, 200);
  assert.equal(owed(back.id), 0);
  assert.equal(cents(row(back.id).finalPrice), 33000);
  assert.equal(imbalance(back.id), 0);

  const refunded = collectedEarly();
  assert.equal(extraSale.changeLine(refunded.id, refunded.beerRef(), { offered: true }, { now: refunded.pre, forceOverpayment: true }).status, 200);
  refundAsProposed(refunded.id);
  const again = extraSale.changeLine(refunded.id, refunded.beerRef(), { offered: false }, { now: refunded.pre });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'LINE_REFUNDED');
  assert.equal(imbalance(refunded.id), 0);
});

test('B8-5 — direct stay: the collected complement stays the trop-perçu formula\'s (no claim read twice)', () => {
  const { platformComplementClaims } = require('../utils/paidLineJudgment');
  const { id } = collectedEarly();
  assert.ok(platformComplementClaims(row(id)));
  assert.equal(platformComplementClaims({ ...row(id), platform: 'direct' }), null);
  assert.equal(platformComplementClaims({ ...row(id), complementPaid: 0, complementPaidCash: 0 }), null);
});

test('B8-6 — Booking, beer discounted before the arrival on the collected complement: later sales of the stay go through', () => {
  const { id, pre, beerRef } = collectedEarly();
  assert.equal(extraSale.changeLine(id, beerRef(), { discount: { amount: 24 } }, { now: pre, forceOverpayment: true }).status, 200);
  call(ctrl.updatePayment, { id: String(id) }, { checkInDone: true });
  const at = new Date(`${addDaysToIsoDate(row(id).startDate, 1)}T12:00:00`);
  const paid = extraSale.sell(id, [{ articleRef: `option:${plank}`, quantity: 1 }], { now: at, payment: 'card' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const unpaid = extraSale.sell(id, [{ articleRef: `option:${plank}`, quantity: 1 }], { now: at });
  assert.equal(unpaid.status, 200, JSON.stringify(unpaid.body));
  assert.equal(imbalance(id), 0);
});

test('B8-6 — the « sold at arrival » floor: a reduction made by the save is refused, one it found is not', () => {
  const line = (totalPrice) => ({ optionId: beer, quantity: 5, totalPrice, offered: 0 });
  const baseline = JSON.stringify({ [`opt:${beer}`]: 30 });
  assert.deepEqual(arrivalExtrasViolations(baseline, [line(6)], [line(6)]), []);
  assert.deepEqual(arrivalExtrasViolations(baseline, [line(6)], [line(3)]).map((v) => v.reason), ['reduced']);
  assert.deepEqual(arrivalExtrasViolations(baseline, [line(30)], [line(24)]).map((v) => v.reason), ['reduced']);
});
