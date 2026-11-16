// specs/pricing-components.md §3 rule 113 (stabilisation loop t8, B8-2) — a `lineLowered` row holds the stay's own trop-perçu too (a solde line
// discounted before the arrival), not only note money. What a refund on the trop-perçu gives back is stamped with its NOTE part
// (`refund_obligations.noteCents`) and only that part is « note money already refunded »: the engine's note credit (rule 110), the rule-108
// refusal, `noteExcessCents` (D6-1) and the cash part of rule 112 read it. Scenario of the review: beer 30 in the solde (paid 330), discounted 24
// at J-2 and the 24 refunded by transfer; in the stay a plank 20 paid by a note is offered (owed 20); then a jam 15 sold unpaid. Before, the
// 24 refunded wiped the plank's 20 € credit: « À percevoir au départ 15 » AND « Trop-perçu 5 » (336 ≠ 321).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');

const option = (title, price) => {
  const id = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES (?, ?, 'per_stay')").run(title, price).lastInsertRowid);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9701, ?)').run(id);
  return id;
};
const plank = option('Planche solde', 20);
const jam = option('Confiture solde', 15);
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const refunds = require('../controllers/refundsController');
const paidLineJudgment = require('../utils/paidLineJudgment');
const { storedBody } = require('../utils/stayOrderLines');

const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const call = (handler, params, body) => { const res = respond(); handler({ params, body, query: {}, user: { id: 1, role: 'admin' } }, res); return res; };
const cents = (v) => Math.round(Number(v || 0) * 100);
const ledgerOf = (id) => call(ctrl.getById, { id }, undefined).body.ledger;
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
const refundedCents = (id) => cents(db.prepare('SELECT COALESCE(SUM(totalTtc), 0) AS t FROM reservation_refunds WHERE reservationId = ?').get(id).t);
const notesCents = (id) => JSON.parse(row(id).midStaySettledNotes || '[]').reduce((sum, note) => sum + cents(note.total), 0);
// Σ buckets + notes − still owed − refunded = the stay's total (price + tax), what is still asked included.
const imbalance = (id) => {
  const r = row(id);
  return cents(r.depositAmount) + cents(r.balanceAmount) + cents(r.complementAmount) + cents(r.endOfStayComplementAmount) + notesCents(id)
    - owed(id) - refundedCents(id) - cents(r.finalPrice) - cents(r.touristTaxTotal);
};

function refundAsProposed(id) {
  const over = ctrl.storedOverpayment(id);
  const made = call(refunds.create, { id: String(id) }, {
    refundDate: todayIso(), method: over.overpaymentMethod || 'transfer', reason: 'Trop-perçu', fromOverpayment: true, overpaymentTtc: over.overpaymentTtc,
    lines: over.overpaymentLines.map((l) => ({ label: 'Trop-perçu', bucket: l.bucket, amountTtc: l.amountTtc })),
  });
  assert.equal(made.statusCode, 201, JSON.stringify(made.body));
  return made.body.refund.id;
}

// The solde (beer 30 in it) paid, the beer discounted 24 at J-2 and those 24 refunded; then in the stay a plank paid by a note and offered.
function soldeRefundedThenNoteOffered(payment, { refundSolde = true } = {}) {
  const id = stay(20);
  const body = storedBody(id);
  body.options = [...(body.options || []), { optionId: beer, quantity: 5 }];
  ctrl.performUpdate(id, { ...body, restatePricing: true });
  call(ctrl.updatePayment, { id: String(id) }, { balancePaid: true, balancePaidDate: todayIso() });
  const pre = new Date(`${addDaysToIsoDate(row(id).startDate, -2)}T12:00:00`);
  const beerLine = extraSale.saleDetailOf(id, pre).lines.find((l) => l.articleKey === `option:${beer}`);
  assert.equal(extraSale.changeLine(id, beerLine.ref, { discount: { amount: 24 } }, { now: pre, forceOverpayment: true }).status, 200);
  assert.equal(owed(id), 2400);
  if (refundSolde) {
    refundAsProposed(id);
    const settled = db.prepare("SELECT amountCents, noteCents FROM refund_obligations WHERE reservationId = ? AND status = 'settled'").all(id);
    assert.deepEqual(settled, [{ amountCents: 2400, noteCents: 0 }], 'solde money given back is no note money');
  }
  call(ctrl.updatePayment, { id: String(id) }, { checkInDone: true });
  const at = (t) => new Date(`${addDaysToIsoDate(row(id).startDate, 1)}T${t}:00`);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${plank}`, quantity: 1 }], { now: at('12:00'), payment }).status, 200);
  const plankRef = () => extraSale.saleDetailOf(id, at('13:00')).lines.find((l) => l.articleKey === `option:${plank}`).ref;
  const asked = extraSale.changeLine(id, plankRef(), { offered: true }, { now: at('13:00') });
  assert.equal(asked.status, 409);
  assert.equal(asked.body.overpaymentTtc, refundSolde ? 20 : 44);
  assert.equal(extraSale.changeLine(id, plankRef(), { offered: true }, { now: at('13:00'), forceOverpayment: true }).status, 200);
  return { id, at, plankRef };
}

for (const payment of ['card', 'cash']) {
  test(`B8-2 (a) — direct, note by ${payment}: the solde's refund leaves the note's credit whole; a 15 € line sold unpaid is absorbed, 5 stay owed`, () => {
    const { id, at } = soldeRefundedThenNoteOffered(payment);
    assert.equal(paidLineJudgment.refundedLoweredCents(db, id), 0);
    assert.equal(paidLineJudgment.noteExcessCents(db, id), 2000);
    assert.equal(owed(id), 2000);
    assert.equal(extraSale.sell(id, [{ articleRef: `option:${jam}`, quantity: 1 }], { now: at('14:00') }).status, 200);
    const ledger = ledgerOf(id);
    assert.equal(ledger.remaining, 0);
    assert.deepEqual(ledger.rows.filter((x) => ['endOfStayComplement', 'overpayment'].includes(x.key)).map((x) => [x.key, x.amount, x.stateLabel]),
      [['overpayment', 5, 'À rembourser']]);
    assert.equal(extraSale.saleDetailOf(id, at('15:00')).totals.dueCents, 0);
    assert.equal(owed(id), 500);
    assert.equal(imbalance(id), 0);
  });
}

test('B8-2 (a) control — without the solde refund, the 15 € line is absorbed as well and 29 stay owed', () => {
  const { id, at } = soldeRefundedThenNoteOffered('card', { refundSolde: false });
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${jam}`, quantity: 1 }], { now: at('14:00') }).status, 200);
  assert.equal(ledgerOf(id).remaining, 0);
  assert.equal(owed(id), 2900);
  assert.equal(imbalance(id), 0);
});

test('B8-2 (b) — the plank nobody refunded can be un-offered, by the line API and by the fiche (no false LINE_REFUNDED)', () => {
  const first = soldeRefundedThenNoteOffered('card');
  assert.deepEqual(paidLineJudgment.refundedLoweredLines(db, first.id), []);
  const back = extraSale.changeLine(first.id, first.plankRef(), { offered: false }, { now: first.at('14:00') });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal(owed(first.id), 0);
  assert.equal(imbalance(first.id), 0);

  const second = soldeRefundedThenNoteOffered('card');
  const fiche = storedBody(second.id);
  fiche.options = fiche.options.map((o) => (Number(o.optionId) === plank ? { ...o, offered: false } : o));
  fiche.offeredOptionIds = (fiche.offeredOptionIds || []).filter((optionId) => Number(optionId) !== plank);
  const saved = ctrl.performUpdate(second.id, fiche);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(owed(second.id), 0);
  assert.equal(imbalance(second.id), 0);
});

test('B8-2 (b) — the plank refunded is still refused (rule 108 holds on note money)', () => {
  const { id, at, plankRef } = soldeRefundedThenNoteOffered('card');
  refundAsProposed(id);
  assert.equal(paidLineJudgment.refundedLoweredCents(db, id), 2000);
  const back = extraSale.changeLine(id, plankRef(), { offered: false }, { now: at('14:00') });
  assert.equal(back.status, 409);
  assert.equal(back.body.code, 'LINE_REFUNDED');
  assert.equal(imbalance(id), 0);
});

test('B8-2 (c) — direct, cash note: after the solde refund by transfer the note\'s freed 20 default to the caisse interne', () => {
  const { id } = soldeRefundedThenNoteOffered('cash');
  const over = ctrl.storedOverpayment(id);
  assert.equal(over.overpaymentTtc, 20);
  assert.equal(over.overpaymentMethod, 'internal');
  assert.equal(over.overpaymentCash, undefined);
});

test('B8-2 — a mixed refund (solde 24 + note 20 in one) stamps only the note part, and deleting it clears the stamp', () => {
  const { id } = soldeRefundedThenNoteOffered('card', { refundSolde: false });
  const refundId = refundAsProposed(id);
  assert.equal(paidLineJudgment.refundedLoweredCents(db, id), 2000);
  const settled = db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS a, COALESCE(SUM(noteCents), 0) AS n FROM refund_obligations WHERE reservationId = ? AND status = 'settled'").get(id);
  assert.deepEqual({ ...settled }, { a: 4400, n: 2000 });
  assert.equal(imbalance(id), 0);
  const gone = respond();
  refunds.remove({ params: { id: String(id), refundId: String(refundId) }, query: {}, user: { id: 1, role: 'admin' } }, gone);
  assert.equal(gone.statusCode, 200, JSON.stringify(gone.body));
  assert.equal(paidLineJudgment.refundedLoweredCents(db, id), 0);
  assert.equal(owed(id), 4400);
  assert.equal(imbalance(id), 0);
});
