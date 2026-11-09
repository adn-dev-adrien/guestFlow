// specs/mixed-method-payments.md rule 51 (audit R34 NEW-2) — a payment with several methods that paid several buckets
// (the single arrival payment, the complement carrying the end of stay, the SAS departure) is taken back whole or not
// at all: un-ticking ONE of its buckets would drop the whole settlement and leave the other bucket paid in full on the
// books (caisse-interne money turned into revenue), or forget the reste. 409, nothing written; the group's « Annuler »
// takes the whole payment back.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  controller, respond, ADMIN, TODAY, rowOf, mark, NO_ACOMPTE, forced, fiche,
} = require('./moneyLedgerFixture');
const settlementsModel = require('../models/paymentSettlementsModel');
const { comptaCollected, cashCollected, remainingToPay } = require('../utils/reservationSettlement');
const { takeBackRefusal } = require('../utils/reservationPaymentMark');

const MESSAGE = 'Paiement en plusieurs moyens : annulez le paiement unique en entier.';
const cents = (euros) => Math.round(Number(euros) * 100);
const card = (amountCents) => ({ method: 'card', amountCents, internal: false });
const cashIn = (amountCents) => ({ method: 'cash', amountCents, internal: true });

function call(handler, params, body) {
  const res = respond();
  handler({ params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), body, user: ADMIN }, res);
  return res;
}

function arrivalSplit(tenders, shortfall) {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(80)] });
  const r0 = rowOf(stay.id);
  const due = cents(r0.balanceAmount) + cents(r0.complementAmount);
  const res = call(controller.settleArrivalPayment, { id: stay.id }, {
    mode: 'split', date: TODAY, expectedAmountCents: due, tenders: tenders(due), ...(shortfall ? { shortfall } : {}),
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return stay;
}

const snapshot = (id) => {
  const r = rowOf(id);
  return {
    balancePaid: r.balancePaid, complementPaid: r.complementPaid, group: r.arrivalPaymentGroup, settlements: settlementsModel.listFor(id).length,
    compta: comptaCollected(r), cash: cashCollected(r), remaining: remainingToPay(r), due: r.splitShortfallDue,
  };
};

test('specs/mixed-method-payments.md rule 51 — caisse + CB over solde and complement, the complement un-ticked: 409, nothing written (P14)', () => {
  const stay = arrivalSplit((due) => [cashIn(30000), card(due - 30000)]);
  const before = snapshot(stay.id);
  assert.equal(before.cash, 300);
  const res = mark(stay.id, { complementPaid: false });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, MESSAGE);
  assert.equal(res.body.code, 'SPLIT_TAKEN_BACK_IN_PART');
  assert.deepEqual(snapshot(stay.id), before);
});

test('specs/mixed-method-payments.md rule 51 — a reste on the single payment, the solde un-ticked: 409, the reste stays (P13)', () => {
  const stay = arrivalSplit((due) => [card(due - 5000)], { kind: 'due' });
  const before = snapshot(stay.id);
  assert.equal(before.due, 50);
  for (const body of [{ balancePaid: false }, { complementPaid: false }]) {
    const res = mark(stay.id, body);
    assert.equal(res.statusCode, 409, JSON.stringify(res.body));
    assert.equal(res.body.error, MESSAGE);
  }
  assert.deepEqual(snapshot(stay.id), before);
});

test('specs/mixed-method-payments.md rule 51 — the group\'s « Annuler » still takes the whole payment back', () => {
  const stay = arrivalSplit((due) => [cashIn(30000), card(due - 30000)]);
  const res = call(controller.settleArrivalPayment, { id: stay.id }, { mode: 'undo' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = rowOf(stay.id);
  assert.equal(r.balancePaid, 0);
  assert.equal(r.complementPaid, 0);
  assert.equal(settlementsModel.listFor(stay.id).length, 0);
});

test('specs/mixed-method-payments.md rule 51 — a caller taking one mark back without the PATCH (SAS, reconciliation) is refused too', () => {
  const stay = arrivalSplit((due) => [cashIn(30000), card(due - 30000)]);
  const refusal = takeBackRefusal(stay.id, { flags: ['complementPaid'] });
  assert.equal(refusal && refusal.status, 409);
  assert.equal(refusal.body.error, MESSAGE);
  assert.equal(takeBackRefusal(stay.id, { flags: ['balancePaid', 'complementPaid'] }), null);
});

test('specs/mixed-method-payments.md rule 51 — a split over one bucket is still un-ticked alone (rule 13)', () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(80)] });
  const due = cents(rowOf(stay.id).balanceAmount);
  assert.equal(mark(stay.id, { balancePaid: true, balancePaidDate: TODAY, expectedAmountCents: due, tenders: [cashIn(10000), card(due - 10000)] }).statusCode, 200);
  const res = mark(stay.id, { balancePaid: false });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(settlementsModel.listFor(stay.id).length, 0);
});

// A checked-out direct stay: 20 € arrival complement deferred to the check-out, 12 € end of stay, collected on ONE card
// with several methods (defer-arrival-complement-to-checkout rule 8): the settlement pays both buckets.
function mergedSplit() {
  const { db, inDays, S, pay } = require('./moneyLedgerFixture');
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S);
  db.prepare('UPDATE reservations SET complementDeferredToCheckout = 1, endOfStayComplementAmount = 12, startDate = ?, endDate = ? WHERE id = ?')
    .run(inDays(-5), inDays(-3), stay.id);
  const res = mark(stay.id, { complementPaid: true, complementPaidDate: TODAY, expectedAmountCents: 3200, tenders: [cashIn(1000), card(2200)] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(settlementsModel.listFor(stay.id)[0].parts.map((p) => p.kind), ['complement', 'endOfStayComplement']);
  return stay;
}

test('specs/mixed-method-payments.md rule 51 — the merged complement + end of stay: un-ticking the end of stay alone is refused', () => {
  const stay = mergedSplit();
  const before = snapshot(stay.id);
  const res = mark(stay.id, { endOfStayComplementPaid: false });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, MESSAGE);
  assert.deepEqual(snapshot(stay.id), before);
  assert.equal(rowOf(stay.id).endOfStayComplementPaid, 1);
  assert.equal(takeBackRefusal(stay.id, { flags: ['endOfStayComplementPaid'] }).body.error, MESSAGE);
});

test('specs/mixed-method-payments.md rule 51 — the merged card\'s « Annuler » takes both buckets back', () => {
  const stay = mergedSplit();
  const res = mark(stay.id, { complementPaid: false });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).endOfStayComplementPaid, 0);
  assert.equal(settlementsModel.listFor(stay.id).length, 0);
});

// specs/mixed-method-payments.md rule 53 — a bucket a payment with several methods paid has no caisse switch: its lines
// say where its money is (rule 11), only « Modifier » moves it.
const SWITCH = 'Paiement en plusieurs moyens : passer par « Modifier ».';

test('specs/mixed-method-payments.md rule 53 — the single payment\'s complement switched to the caisse: 409, the books keep the card money', () => {
  const stay = arrivalSplit((due) => [cashIn(30000), card(due - 30000)]);
  const before = snapshot(stay.id);
  const res = mark(stay.id, { complementPaidCash: true });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, SWITCH);
  assert.equal(res.body.code, 'SPLIT_CAISSE_SWITCH');
  assert.deepEqual(snapshot(stay.id), before);
});

test('specs/mixed-method-payments.md rule 53 — a complement paid alone with several methods: no caisse switch either way', () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(80)] });
  assert.equal(mark(stay.id, { complementPaid: true, complementPaidDate: TODAY, expectedAmountCents: 8000, tenders: [cashIn(3000), card(5000)] }).statusCode, 200);
  const before = snapshot(stay.id);
  assert.equal(mark(stay.id, { complementPaidCash: true }).statusCode, 409);
  assert.deepEqual(snapshot(stay.id), before);
  const all = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(80)] });
  assert.equal(mark(all.id, { complementPaid: true, complementPaidDate: TODAY, expectedAmountCents: 8000, tenders: [cashIn(3000), { method: 'cash', amountCents: 5000, internal: false }] }).statusCode, 200);
  assert.equal(mark(all.id, { complementPaidCash: true }).statusCode, 409);
});

test('specs/mixed-method-payments.md rule 53 — a complement paid with one method keeps its caisse switch', () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(80)] });
  assert.equal(mark(stay.id, { complementPaid: true, complementPaidDate: TODAY }).statusCode, 200);
  assert.equal(mark(stay.id, { complementPaidCash: true }).statusCode, 200);
  assert.equal(rowOf(stay.id).complementPaidCash, 1);
});
