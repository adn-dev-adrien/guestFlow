// Audit R28-C-M1 (2026-11-08) — specs/defer-arrival-complement-to-checkout.md rule 22 and
// specs/reservation-payment-ledger.md rule 69. A complement deferred to the check-out is merged with the end of stay only
// while it is still to collect (`complementPaid` ≠ 1 and an amount above 0, the normalisation of buildCheckoutComplement),
// and the merged card never carries an end of stay already settled. Its mark (PATCH /payment and the preview the guards
// read) never re-dates nor clears an end-of-stay complement collected on its own: the stored state of stay 22281
// (deferral 1, arrival complement 0 €, end of stay collected in a « paiement unique ») showed a 50 € card « À percevoir au
// départ » whose « Marquer perçu » moved the collection to another month and whose « Annuler » erased it.
// Kept: the merged card stays open while its end of stay is settled (R26 D20 finding 4) and D20's refusal.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, inDays, rowOf, mark, NO_ACOMPTE, S, C, forced, fiche, pay, storedEndOfStayPaid, ficheView,
} = require('./moneyLedgerFixture');
const { buildCheckoutComplement } = require('../utils/checkoutComplement');
const { __test: { paymentPatchChanges } } = require('../controllers/reservationsController');

const COLLECTED_ON = inDays(-3);
const rowsOf = (id) => ficheView(id).ledger.rows;
const rowOfKey = (id, key) => rowsOf(id).find((r) => r.key === key);
const endOfStayFlags = (id) => {
  const r = rowOf(id);
  return [r.endOfStayComplementPaid, r.endOfStayComplementPaidCash, r.endOfStayComplementPaidDate];
};
const deferWith = (id, endOfStayAmount) => db.prepare('UPDATE reservations SET complementDeferredToCheckout = 1, endOfStayComplementAmount = ? WHERE id = ?')
  .run(endOfStayAmount, id);

// Stay 22281 as stored: solde and end of stay collected together in a single payment, the deferral left at 1 over a 0 € arrival complement.
function stay22281() {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  deferWith(stay.id, 50);
  storedEndOfStayPaid(stay.id, { date: COLLECTED_ON });
  const group = JSON.stringify({ at: COLLECTED_ON, cash: 0, total: Math.round((rowOf(stay.id).balanceAmount + 50) * 100) / 100, buckets: ['balance', 'endOfStayComplement'] });
  db.prepare('UPDATE reservations SET balancePaidDate = ?, arrivalPaymentGroup = ? WHERE id = ?').run(COLLECTED_ON, group, stay.id);
  assert.equal(rowOf(stay.id).complementAmount, 0);
  return { ...stay, group };
}

// A 20 € arrival complement still to collect, deferred, over an end of stay of 50 € already collected on its own.
function deferredOverSettled({ cash = false } = {}) {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S);
  deferWith(stay.id, 50);
  storedEndOfStayPaid(stay.id, { date: COLLECTED_ON, cash });
  return stay;
}

test('guard 1: a deferral over a 0 € arrival complement draws the collected end of stay on its own card (stay 22281)', () => {
  const stay = stay22281();
  assert.equal(rowOfKey(stay.id, 'checkoutComplement'), undefined, 'no merged card « À percevoir au départ »');
  const own = rowOfKey(stay.id, 'endOfStayComplement');
  assert.equal(own.amount, 50);
  assert.equal(own.state, 'paid-group');
  assert.equal(own.paidDate, COLLECTED_ON);
  assert.equal(ficheView(stay.id).ledger.remaining, 0);
  assert.equal(ficheView(stay.id).checkoutComplement.deferred, false);
});

test('guard 1: an arrival complement already paid under the deferral keeps its own card, the end of stay its own', () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  deferWith(stay.id, 12);
  assert.equal(rowOfKey(stay.id, 'checkoutComplement'), undefined);
  assert.equal(rowOfKey(stay.id, 'complement').state, 'paid');
  const own = rowOfKey(stay.id, 'endOfStayComplement');
  assert.equal(own.amount, 12);
  assert.equal(own.state, 'due');
  assert.equal(own.action.label, 'Marquer perçu');
});

test('guard 1, refusal: the 22281 state has no complement to mark, 409 NOTHING_TO_COLLECT, nothing written', () => {
  const stay = stay22281();
  const res = mark(stay.id, { ...C, expectedAmountCents: 5000 });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'NOTHING_TO_COLLECT');
  assert.equal(rowOf(stay.id).complementPaid, 0);
  assert.deepEqual(endOfStayFlags(stay.id), [1, 0, COLLECTED_ON]);
});

test('guard 2, untick: un-ticking the arrival part never clears an end of stay collected on its own, the group stays', () => {
  const stay = stay22281();
  const res = mark(stay.id, { complementPaid: false });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(endOfStayFlags(stay.id), [1, 0, COLLECTED_ON]);
  assert.equal(rowOf(stay.id).arrivalPaymentGroup, stay.group);
  assert.equal(ficheView(stay.id).ledger.remaining, 0);

  const paired = deferredOverSettled();
  pay(paired.id, C);
  assert.equal(mark(paired.id, { complementPaid: false }).statusCode, 200);
  assert.equal(rowOf(paired.id).complementPaid, 0);
  assert.deepEqual(endOfStayFlags(paired.id), [1, 0, COLLECTED_ON]);
});

test('guard 2, PATCH write: the merged mark never re-dates a settled end of stay, books or caisse interne', () => {
  const stay = deferredOverSettled();
  const res = mark(stay.id, { complementPaid: true, complementPaidDate: inDays(0), expectedAmountCents: 2000 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).complementPaid, 1);
  assert.deepEqual(endOfStayFlags(stay.id), [1, 0, COLLECTED_ON]);

  const cash = deferredOverSettled({ cash: true });
  assert.equal(mark(cash.id, { complementPaidCash: true }).statusCode, 200);
  assert.equal(rowOf(cash.id).complementPaidCash, 1);
  assert.deepEqual(endOfStayFlags(cash.id), [1, 1, COLLECTED_ON]);
});

test('guard 2, preview: the changes the guards read carry no end-of-stay column over a settled end of stay', () => {
  const settled = rowOf(deferredOverSettled().id);
  for (const body of [{ complementPaid: true }, { complementPaidCash: true }, { complementPaid: false }]) {
    const changes = paymentPatchChanges(settled, body, inDays(0));
    assert.equal(changes.endOfStayComplementPaid, undefined, JSON.stringify(body));
    assert.equal(changes.endOfStayComplementPaidCash, undefined, JSON.stringify(body));
  }
  assert.equal(paymentPatchChanges(rowOf(stay22281().id), { complementPaid: false }, inDays(0)).endOfStayComplementPaid, undefined);
  // Still due, the end of stay rides the merged mark (defer-arrival-complement-to-checkout rule 8).
  const due = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  deferWith(due.id, 12);
  assert.equal(paymentPatchChanges(rowOf(due.id), { complementPaid: true }, inDays(0)).endOfStayComplementPaid, 1);
});

test('guard 3: the merged card leaves a settled end of stay out of its amount, and stays open (R26 D20 finding 4)', () => {
  const stay = deferredOverSettled();
  const merged = rowOfKey(stay.id, 'checkoutComplement');
  assert.equal(merged.amount, 20);
  assert.equal(merged.state, 'due');
  assert.equal(merged.action.disabled, undefined);
  const own = rowOfKey(stay.id, 'endOfStayComplement');
  assert.equal(own.amount, 50);
  assert.equal(own.state, 'paid');
  const block = ficheView(stay.id).checkoutComplement;
  assert.equal(block.deferred, true);
  assert.equal(block.amount, 20);
  assert.equal(block.endOfStayAmount, 0);
  assert.deepEqual([...new Set(block.lines.map((l) => l.origin))], ['arrival']);
  assert.equal(ficheView(stay.id).ledger.remaining, 20);
  const stale = mark(stay.id, { ...C, expectedAmountCents: 7000 });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.code, 'AMOUNT_CHANGED');
});

test('buildCheckoutComplement: deferred only while the arrival part is due; a settled end of stay leaves the block', () => {
  const lines = [{ label: 'Bois', qty: 1, unitPrice: 50, amount: 50 }];
  const base = { complementDeferredToCheckout: 1, complementAmount: 20, endOfStayComplementAmount: 50, endOfStayComplementDetail: lines };
  const arrival = { amount: 20, detail: [{ label: 'Draps', qty: 1, unitPrice: 20, amount: 20 }] };
  assert.equal(buildCheckoutComplement(base, arrival).amount, 70);
  const settled = buildCheckoutComplement({ ...base, endOfStayComplementPaidCash: 1 }, arrival);
  assert.deepEqual([settled.deferred, settled.amount, settled.endOfStayAmount, settled.paid], [true, 20, 0, false]);
  assert.deepEqual(settled.lines.map((l) => l.label), ['Draps']);
  assert.equal(buildCheckoutComplement({ ...base, complementAmount: 0 }, { amount: 0, detail: [] }).deferred, false);
  assert.equal(buildCheckoutComplement({ ...base, complementPaid: 1 }, arrival).deferred, false);
});

test('stored summary: a deferred complement already paid is filed at arrival (complement-buckets-by-moment rule 4)', () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  deferWith(stay.id, 12);
  assert.deepEqual(ficheView(stay.id).storedSummary.complementSplit, { arrival: 20, duringStay: 0, endOfStay: 12 });
  db.prepare('UPDATE reservations SET complementPaid = 0, complementPaidDate = NULL WHERE id = ?').run(stay.id);
  assert.deepEqual(ficheView(stay.id).storedSummary.complementSplit, { arrival: 0, duringStay: 0, endOfStay: 32 });
});
