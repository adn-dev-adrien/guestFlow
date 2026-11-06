// specs/reservation-payment-ledger.md rule 68 (D20, Adrien 2026-11-06) — the end-of-stay complement is collected once the
// check-out is done: the departure SAS committed when the sas plugin is live, otherwise the stay's last day reached. Every
// path that would mark it before is refused, 409 END_OF_STAY_BEFORE_CHECKOUT: the fiche's mark (books, caisse interne, the
// merged card of a deferred complement), the reconciliation's write, « Encaisser en une fois ». The fiche's mark is drawn
// closed with its caption; « Tout solder » leaves it out. A mark taken back or a stored paid end of stay passes, untouched.
// Payments during the stay (mid-stay notes) stay open (D20, second sentence; specs/mid-stay-notes.md).
// specs/finance-dashboard-redesign.md rule 15, reading of 2026-11-06: « Tout solder » sends the server's `settleAllFields`.
// specs/defer-arrival-complement-to-checkout.md rule 8, specs/qonto-bank-reconciliation.md rule 34 and
// specs/single-payment-from-the-fiche.md rule 2bis, readings of 2026-11-06 (D20).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, controller, respond, ADMIN, TODAY, inDays, rowOf, mark, NO_ACOMPTE, S, C, forced, free, fiche, put, pay,
  storedEndOfStayPaid, ficheView,
} = require('./moneyLedgerFixture');
const registry = require('../plugins/sdk/registry');
const financeModel = require('../models/financeModel');
const { applyPaymentMark } = require('../utils/reservationPaymentMark');
const { isCheckoutDone } = require('../utils/endOfStayCheckout');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const ficheWriter = optionalPlugin(() => require('../plugins/online-payment/reconciliation/ficheWriter'));
const CODE = 'END_OF_STAY_BEFORE_CHECKOUT';
const MESSAGE = 'Complément de fin de séjour encaissable après le départ.';
const CAPTION = 'Après le départ.';
const E = { endOfStayComplementPaid: true, endOfStayComplementPaidDate: TODAY };

// Solde and arrival complement paid, then a 30 € line sold: the end of stay holds 30 € (D9).
async function withEndOfStay() {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { customOptions: [forced(20), free(30, 'Ajout', null)] });
  assert.equal(rowOf(stay.id).endOfStayComplementAmount, 30);
  return stay;
}
const setDates = (id, startDate, endDate) => db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(startDate, endDate, id);
const running = (id) => setDates(id, inDays(-1), inDays(1));
const departingToday = (id) => setDates(id, inDays(-2), TODAY);
const endOfStayFlags = (id) => {
  const r = rowOf(id);
  return [r.endOfStayComplementPaid, r.endOfStayComplementPaidCash, r.endOfStayComplementPaidDate];
};
const refused = (res) => {
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.deepEqual(res.body, { error: MESSAGE, code: CODE });
};
const ledgerRow = (id, key) => ficheView(id).ledger.rows.find((r) => r.key === key);
function sasLive(fn) {
  registry.ensure('sas');
  registry.configure({ isActive: () => true, allows: () => true });
  try { return fn(); } finally { registry.reset(); }
}
function settleArrival(id, mode = 'card') {
  const res = respond();
  controller.settleArrivalPayment({ params: { id: String(id) }, body: { mode, date: TODAY }, user: ADMIN }, res);
  return res;
}

test('check-out done: the departure SAS when the sas plugin is live, otherwise the last day reached', () => {
  const row = { endDate: '2026-08-10', departureSasDoneAt: null }; // date-literal-ok: inputs of the pure isCheckoutDone, today injected
  assert.equal(isCheckoutDone(row, { today: '2026-08-09', sasActive: false }), false); // date-literal-ok: inputs of the pure isCheckoutDone, today injected
  assert.equal(isCheckoutDone(row, { today: '2026-08-10', sasActive: false }), true); // date-literal-ok: inputs of the pure isCheckoutDone, today injected
  assert.equal(isCheckoutDone(row, { today: '2026-09-01', sasActive: true }), false); // date-literal-ok: inputs of the pure isCheckoutDone, today injected
  assert.equal(isCheckoutDone({ ...row, departureSasDoneAt: '2026-08-10 10:00:00' }, { today: '2026-08-09', sasActive: true }), true); // date-literal-ok: inputs of the pure isCheckoutDone, today injected
  assert.equal(isCheckoutDone({ endDate: '' }, { today: '2026-08-10', sasActive: false }), false); // date-literal-ok: inputs of the pure isCheckoutDone, today injected
  assert.equal(isCheckoutDone(null), false);
});

test('fiche mark before the check-out: refused, books and caisse interne, nothing written', async () => {
  const stay = await withEndOfStay();
  running(stay.id);
  refused(mark(stay.id, E));
  refused(mark(stay.id, { endOfStayComplementPaidCash: true, endOfStayComplementPaidDate: TODAY }));
  refused(mark(stay.id, { ...E, expectedAmountCents: 3000 }));
  assert.deepEqual(endOfStayFlags(stay.id), [0, 0, null]);
});

test('a future stay (D9 growth paid before arrival): refused the same', async () => {
  const stay = await withEndOfStay();
  refused(mark(stay.id, E));
  assert.deepEqual(endOfStayFlags(stay.id), [0, 0, null]);
});

test('the last day reached (no sas plugin): the mark passes', async () => {
  const stay = await withEndOfStay();
  departingToday(stay.id);
  assert.equal(mark(stay.id, E).statusCode, 200);
  assert.deepEqual(endOfStayFlags(stay.id), [1, 0, TODAY]);
});

test('sas plugin live: a past stay without its departure SAS is refused, the SAS committed opens it', async () => {
  const stay = await withEndOfStay();
  setDates(stay.id, inDays(-5), inDays(-3));
  sasLive(() => {
    refused(mark(stay.id, E));
    db.prepare("UPDATE reservations SET departureSasDoneAt = datetime('now') WHERE id = ?").run(stay.id);
    assert.equal(mark(stay.id, E).statusCode, 200);
  });
  assert.equal(rowOf(stay.id).endOfStayComplementPaid, 1);
});

test('a complement deferred to the check-out: its merged mark is refused, un-deferred it is collected alone', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S);
  db.prepare('UPDATE reservations SET complementDeferredToCheckout = 1, endOfStayComplementAmount = 12 WHERE id = ?').run(stay.id);
  running(stay.id);
  refused(mark(stay.id, C));
  refused(mark(stay.id, { complementPaidCash: true }));
  assert.equal(rowOf(stay.id).complementPaid, 0);
  const res = mark(stay.id, { ...C, complementDeferredToCheckout: false });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).complementPaid, 1);
  assert.deepEqual(endOfStayFlags(stay.id), [0, 0, null]);
});

test('a stored paid end of stay is never rewritten: mode switch, un-tick and an unchanged save pass', async () => {
  const stay = await withEndOfStay();
  storedEndOfStayPaid(stay.id);
  const saved = respond();
  await controller.update({ params: { id: stay.id }, body: { ...stay.body, notes: 'Arrivée tardive', forceOverpayment: true }, user: ADMIN }, saved);
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.deepEqual(endOfStayFlags(stay.id), [1, 0, TODAY]);
  running(stay.id);
  assert.equal(mark(stay.id, { endOfStayComplementPaidCash: true }).statusCode, 200);
  assert.equal(mark(stay.id, { endOfStayComplementPaid: false }).statusCode, 200);
  assert.deepEqual(endOfStayFlags(stay.id), [0, 0, null]);
  refused(mark(stay.id, E));
});

test('the reconciliation write (applyPaymentMark): refused before the check-out', async () => {
  const stay = await withEndOfStay();
  running(stay.id);
  const answer = applyPaymentMark({ reservationId: stay.id, body: E, user: ADMIN });
  assert.equal(answer.status, 409);
  assert.equal(answer.body.code, CODE);
  assert.deepEqual(endOfStayFlags(stay.id), [0, 0, null]);
});

test('« Confirmer » on an end-of-stay receipt: the fiche refuses, nothing recorded', { skip: skipWithout(['online-payment']) }, async () => {
  const stay = await withEndOfStay();
  running(stay.id);
  const recorded = [];
  const writer = ficheWriter.createFicheWriter({
    model: { recordFicheWrite: (w) => recorded.push(w) },
    applyPaymentMark,
    computePlatformCommission: () => null,
    reservations: require('../models/reservationsModel'),
  });
  const out = writer.writeIfComplete({
    receipt: { reservationId: stay.id, ledgerKey: 'endOfStayComplement', paid: false },
    lines: [{ amountCents: 3000, settledAt: `${TODAY}T09:00:00Z`, transactionId: 'tx-d20' }],
    expectedBankCents: 3000,
    user: ADMIN,
  });
  assert.equal(out.written, false);
  assert.equal(out.reason, 'refused');
  assert.equal(out.error.body.code, CODE);
  assert.deepEqual(recorded, []);
  assert.deepEqual(endOfStayFlags(stay.id), [0, 0, null]);
});

test('« Encaisser en une fois » before the check-out: the end of stay is not part of it', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 25 WHERE id = ?').run(stay.id);
  running(stay.id);
  assert.deepEqual(ficheView(stay.id).arrivalPayment.collectible.buckets.map((b) => b.bucket), ['balance', 'complement']);
  const res = settleArrival(stay.id);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = rowOf(stay.id);
  assert.deepEqual([row.balancePaid, row.complementPaid], [1, 1]);
  assert.deepEqual(endOfStayFlags(stay.id), [0, 0, null]);
});

test('« Encaisser en une fois » with only the end of stay left: the D20 refusal, nothing written', async () => {
  const stay = await withEndOfStay();
  running(stay.id);
  refused(settleArrival(stay.id));
  refused(settleArrival(stay.id, 'cash'));
  assert.deepEqual(endOfStayFlags(stay.id), [0, 0, null]);
});

test('« Encaisser en une fois » after the check-out: the end of stay is offered and collected with the stay', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 25 WHERE id = ?').run(stay.id);
  departingToday(stay.id);
  assert.deepEqual(ficheView(stay.id).arrivalPayment.collectible.buckets.map((b) => b.bucket), ['balance', 'complement', 'endOfStayComplement']);
  assert.equal(settleArrival(stay.id).statusCode, 200);
  assert.deepEqual(endOfStayFlags(stay.id), [1, 0, TODAY]);
});

test('the fiche: the end-of-stay mark is drawn closed with its caption until the check-out', async () => {
  const stay = await withEndOfStay();
  running(stay.id);
  assert.deepEqual(ledgerRow(stay.id, 'endOfStayComplement').action, {
    kind: 'mark', label: 'Marquer perçu', dateLabel: 'Perçu le', cash: true, disabled: true, reason: CAPTION,
  });
  departingToday(stay.id);
  const open = ledgerRow(stay.id, 'endOfStayComplement').action;
  assert.equal(open.kind, 'mark');
  assert.equal(open.disabled, undefined);
});

test('the fiche: the merged card of a deferred complement is closed while it holds an end of stay', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  db.prepare('UPDATE reservations SET complementDeferredToCheckout = 1 WHERE id = ?').run(stay.id);
  running(stay.id);
  assert.equal(ledgerRow(stay.id, 'checkoutComplement').action.disabled, undefined, 'no end of stay: the arrival part alone');
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 12 WHERE id = ?').run(stay.id);
  assert.equal(ledgerRow(stay.id, 'checkoutComplement').action.disabled, true);
});

test('« Tout solder »: the server leaves the end of stay, and a complement deferred to it, out until the check-out', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  const deferred = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 25 WHERE id IN (?, ?)').run(stay.id, deferred.id);
  db.prepare('UPDATE reservations SET complementDeferredToCheckout = 1 WHERE id = ?').run(deferred.id);
  setDates(stay.id, inDays(-30), inDays(-28));
  setDates(deferred.id, inDays(-40), inDays(-38));
  const fieldsOf = (id) => financeModel.getOperational().pending.reservations.find((r) => r.id === id).settleAllFields;
  assert.deepEqual(fieldsOf(stay.id), ['balancePaid', 'complementPaid', 'endOfStayComplementPaid']);
  assert.deepEqual(fieldsOf(deferred.id), ['balancePaid', 'complementPaid', 'endOfStayComplementPaid']);
  sasLive(() => {
    assert.deepEqual(fieldsOf(stay.id), ['balancePaid', 'complementPaid']);
    assert.deepEqual(fieldsOf(deferred.id), ['balancePaid']);
    assert.equal(mark(stay.id, Object.fromEntries(fieldsOf(stay.id).map((f) => [f, true]))).statusCode, 200);
  });
  assert.deepEqual(endOfStayFlags(stay.id), [0, 0, null]);
});

test('D20 second sentence: a note during the stay is still collected by card while the end of stay waits', async () => {
  const stay = await withEndOfStay();
  running(stay.id);
  refused(mark(stay.id, E));
  const lines = JSON.parse(rowOf(stay.id).endOfStayComplementDetail);
  const res = mark(stay.id, { settleMidStayNote: { checkedKeys: ['custom:ajout'], opening: lines.map((l) => ({ key: l.key, amount: l.amount })) } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const notes = JSON.parse(rowOf(stay.id).midStaySettledNotes);
  assert.deepEqual(notes.map((n) => [n.total, n.paidCash, n.paidDate]), [[30, 0, TODAY]]);
  assert.equal(rowOf(stay.id).endOfStayComplementAmount, 0);
  assert.deepEqual(endOfStayFlags(stay.id), [0, 0, null]);
});

const sasController = optionalPlugin(() => require('../plugins/sas/controller'));
test('the arrival SAS settles the stay and the arrival complement, never the end of stay', { skip: skipWithout(['sas']) }, () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 25 WHERE id = ?').run(stay.id);
  running(stay.id);
  const res = respond();
  sasController.commitArrival({ params: { id: String(stay.id) }, body: { arrivalPaymentMode: 'card' }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = rowOf(stay.id);
  assert.deepEqual([row.balancePaid, row.complementPaid], [1, 1]);
  assert.deepEqual(endOfStayFlags(stay.id), [0, 0, null]);
});
