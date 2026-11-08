// Audit R28 verification N2 (2026-11-08) — specs/defer-arrival-complement-to-checkout.md rule 23. « Settled together »
// reads the paid date and the caisse flag only, so an end of stay collected on its own, then a deferral switched on and
// a complement marked the same day, read as one collection: « Annuler » cleared the end of stay too. The deferral is
// refused instead while the end of stay is settled (books or caisse interne), on every writer of the marker: the fiche's
// PATCH /payment (« Percevoir en fin de séjour », with or without re-opening a paid complement) and the arrival SAS's
// « Plus tard ». Sent back unchanged, switched off, or with the end of stay still due, it passes.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, respond, ADMIN, inDays, rowOf, mark, NO_ACOMPTE, S, forced, fiche, pay, storedEndOfStayPaid, ficheView } = require('./moneyLedgerFixture');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const sasController = optionalPlugin(() => require('../plugins/sas/controller'));
const SAS = { skip: skipWithout(['sas']) };
const CODE = 'DEFERRAL_END_OF_STAY_SETTLED';
const MESSAGE = 'Complément de fin de séjour déjà encaissé.';
const PAID_ON = inDays(-2);

const keysOf = (id) => ficheView(id).ledger.rows.filter((r) => /omplement/i.test(r.key)).map((r) => [r.key, r.amount, r.state]);
const state = (id) => {
  const r = rowOf(id);
  return [r.complementDeferredToCheckout, r.complementPaid, r.complementPaidDate, r.endOfStayComplementPaid, r.endOfStayComplementPaidDate];
};

// A checked-out direct stay with no deferral: 20 € arrival complement, 12 € end of stay, both due.
function checkedOut() {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S);
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 12, startDate = ?, endDate = ? WHERE id = ?')
    .run(inDays(-5), inDays(-3), stay.id);
  return stay;
}

function assertRefused(res) {
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.deepEqual(res.body, { error: MESSAGE, code: CODE });
}

test('probe (a): end of stay ticked on its own, then « Percevoir en fin de séjour » = 409, the collection is kept', () => {
  const stay = checkedOut();
  assert.equal(mark(stay.id, { endOfStayComplementPaid: true, endOfStayComplementPaidDate: PAID_ON }).statusCode, 200);
  assertRefused(mark(stay.id, { complementDeferredToCheckout: true }));
  assert.deepEqual(state(stay.id), [0, 0, null, 1, PAID_ON]);

  // The complement marked the same day stays its own card; its « Annuler » leaves the end of stay collected.
  assert.equal(mark(stay.id, { complementPaid: true, complementPaidDate: PAID_ON }).statusCode, 200);
  assert.deepEqual(keysOf(stay.id), [['complement', 20, 'paid'], ['endOfStayComplement', 12, 'paid']]);
  assert.equal(mark(stay.id, { complementPaid: false }).statusCode, 200);
  assert.deepEqual(state(stay.id), [0, 0, null, 1, PAID_ON]);
  assert.equal(ficheView(stay.id).ledger.remaining, 20);
});

test('probe (b): both ticked on their own cards, « Percevoir en fin de séjour » on the paid complement = 409, nothing re-opened', () => {
  const stay = checkedOut();
  assert.equal(mark(stay.id, { endOfStayComplementPaid: true, endOfStayComplementPaidDate: PAID_ON }).statusCode, 200);
  assert.equal(mark(stay.id, { complementPaid: true, complementPaidDate: PAID_ON }).statusCode, 200);
  assertRefused(mark(stay.id, { complementDeferredToCheckout: true, complementPaid: false, complementPaidCash: false }));
  assert.deepEqual(state(stay.id), [0, 1, PAID_ON, 1, PAID_ON]);
  assert.deepEqual(keysOf(stay.id), [['complement', 20, 'paid'], ['endOfStayComplement', 12, 'paid']]);
  assert.equal(ficheView(stay.id).ledger.remaining, 0);
});

test('an end of stay in the caisse interne refuses the deferral the same way', () => {
  const stay = checkedOut();
  storedEndOfStayPaid(stay.id, { date: PAID_ON, cash: true });
  assertRefused(mark(stay.id, { complementDeferredToCheckout: true }));
  assert.equal(rowOf(stay.id).complementDeferredToCheckout, 0);
});

test('pass: end of stay due, deferral sent back unchanged, deferral switched off', () => {
  const due = checkedOut();
  assert.equal(mark(due.id, { complementDeferredToCheckout: true }).statusCode, 200);
  assert.equal(rowOf(due.id).complementDeferredToCheckout, 1);

  const together = checkedOut();
  db.prepare('UPDATE reservations SET complementDeferredToCheckout = 1 WHERE id = ?').run(together.id);
  assert.equal(mark(together.id, { complementPaid: true, complementPaidDate: PAID_ON }).statusCode, 200);
  assert.deepEqual(keysOf(together.id), [['checkoutComplement', 32, 'paid']]);
  assert.equal(mark(together.id, { complementDeferredToCheckout: true }).statusCode, 200);
  assert.equal(mark(together.id, { complementDeferredToCheckout: false }).statusCode, 200);
  assert.deepEqual(state(together.id), [0, 1, PAID_ON, 1, PAID_ON]);
  // Switched off, it cannot be switched back on over the settled end of stay.
  assertRefused(mark(together.id, { complementDeferredToCheckout: true }));
});

function sas(id, body) {
  const res = respond();
  sasController.commitArrival({ params: { id: String(id) }, body, user: ADMIN }, res);
  return res;
}

function futureWithSettledEndOfStay() {
  const stay = fiche(NO_ACOMPTE, 'direct', { depositDisabled: 1, customOptions: [forced(20)] });
  pay(stay.id, S);
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 12 WHERE id = ?').run(stay.id);
  storedEndOfStayPaid(stay.id, { date: PAID_ON });
  return stay;
}

test('arrival SAS « Plus tard » over a settled end of stay = 409, nothing written', SAS, () => {
  const stay = futureWithSettledEndOfStay();
  assertRefused(sas(stay.id, { arrivalPaymentSplit: true, complementSettled: false }));
  assertRefused(sas(stay.id, { complementSettled: false, arrivalPaymentMode: 'defer' }));
  const r = rowOf(stay.id);
  assert.deepEqual([r.complementDeferredToCheckout, r.complementPaid, r.arrivalSasDoneAt || null], [0, 0, null]);
});

test('arrival SAS settling the complement on the spot over a settled end of stay passes', SAS, () => {
  const stay = futureWithSettledEndOfStay();
  const res = sas(stay.id, { arrivalPaymentSplit: true, complementSettled: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = rowOf(stay.id);
  assert.deepEqual([r.complementDeferredToCheckout, r.complementPaid, r.endOfStayComplementPaid], [0, 1, 1]);
});

test('arrival SAS with no arrival complement over a settled end of stay passes and writes no marker (R28 pass 3 R1)', SAS, () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { depositDisabled: 1 });
  pay(stay.id, S);
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 12 WHERE id = ?').run(stay.id);
  storedEndOfStayPaid(stay.id, { date: PAID_ON });
  const res = sas(stay.id, { complementSettled: false, arrivalPaymentMode: 'defer' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = rowOf(stay.id);
  assert.deepEqual([r.complementDeferredToCheckout, r.endOfStayComplementPaid, Boolean(r.arrivalSasDoneAt)], [0, 1, true]);
});

test('arrival SAS re-opened on a stay already deferred, end of stay settled, « Plus tard » passes (R28 pass 3 R3)', SAS, () => {
  const stay = futureWithSettledEndOfStay();
  db.prepare('UPDATE reservations SET complementDeferredToCheckout = 1 WHERE id = ?').run(stay.id);
  const res = sas(stay.id, { arrivalPaymentSplit: true, complementSettled: false });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = rowOf(stay.id);
  assert.deepEqual([r.complementDeferredToCheckout, r.complementPaid, r.endOfStayComplementPaid], [1, 0, 1]);
});

test('an end of stay held only in the caisse interne (paid flag off) refuses the deferral too', () => {
  const stay = checkedOut();
  db.prepare('UPDATE reservations SET endOfStayComplementPaid = 0, endOfStayComplementPaidCash = 1 WHERE id = ?').run(stay.id);
  assertRefused(mark(stay.id, { complementDeferredToCheckout: true }));
  assert.equal(rowOf(stay.id).complementDeferredToCheckout, 0);
});
