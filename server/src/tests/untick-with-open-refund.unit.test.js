// specs/reservation-refunds.md rule 52 (audit R23 N7, 2026-11-05) — D10's reverse order: a mark taken back must not leave book
// refunds above what stays collected. PATCH and arrival undo answer 409, naming the refund to delete first.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, controller, respond, ADMIN, TODAY, rowOf, mark, NO_ACOMPTE, WITH_ACOMPTE, S, C, D, forced, free, fiche, put, pay, refund, register,
} = require('./moneyLedgerFixture');
const refundsController = require('../controllers/refundsController');

const ACCOMMODATION = 'accommodation';
const CODE = 'REFUND_BLOCKS_UNTICK';
const frDay = `${TODAY.slice(8, 10)}/${TODAY.slice(5, 7)}/${TODAY.slice(0, 4)}`;

const spaced = (text) => text.replace(/\s/g, ' ');

function refuses(id, body, amount) {
  const res = mark(id, body);
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, CODE);
  assert.equal(spaced(res.body.error), `Remboursement du ${frDay} (${amount} €) à supprimer d’abord.`);
  return res;
}
function deleteRefund(id, refundId) {
  const res = respond();
  refundsController.remove({ params: { id, refundId } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
}
const lastRefundId = (id) => register(id).refunds[0].id;

test('solde, 300 € refunded, un-tick: refused, then accepted once the refund is deleted', () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 300 }]).statusCode, 201);
  refuses(stay.id, { balancePaid: false }, '300,00');
  assert.equal(rowOf(stay.id).balancePaid, 1);
  assert.equal(register(stay.id).collectedTtc, 304.8);
  deleteRefund(stay.id, lastRefundId(stay.id));
  assert.equal(mark(stay.id, { balancePaid: false }).statusCode, 200);
  assert.equal(rowOf(stay.id).balancePaid, 0);
});

test('acompte, 100 € refunded, un-tick: refused', () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  pay(stay.id, D);
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 100 }]).statusCode, 201);
  refuses(stay.id, { depositPaid: false }, '100,00');
  assert.equal(rowOf(stay.id).depositPaid, 1);
});

test('complement, 50 € refunded, un-tick: refused, in the caisse interne move too', () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { depositDisabled: 1, customOptions: [forced(50)] });
  pay(stay.id, C);
  assert.equal(refund(stay.id, [{ key: 'custom:forcée', amountTtc: 50 }]).statusCode, 201);
  refuses(stay.id, { complementPaid: false }, '50,00');
  refuses(stay.id, { complementPaid: false, complementPaidCash: true }, '50,00');
  assert.equal(rowOf(stay.id).complementPaid, 1);
});

test('end of stay, un-tick after refunds above what stays: refused', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  pay(stay.id, { endOfStayComplementPaid: true, endOfStayComplementPaidDate: TODAY });
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 600 }]).statusCode, 201);
  assert.equal(refund(stay.id, [{ key: 'custom:forcée', amountTtc: 50 }]).statusCode, 201);
  assert.equal(refund(stay.id, [{ label: 'Geste', bucket: 'options', amountTtc: 30 }]).statusCode, 201);
  const res = mark(stay.id, { endOfStayComplementPaid: false });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, CODE);
  assert.deepEqual(res.body.refundIds, [lastRefundId(stay.id)]);
});

test('two refunds needed: both named, most recent first', () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 100 }]).statusCode, 201);
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 50 }]).statusCode, 201);
  const res = mark(stay.id, { balancePaid: false });
  assert.equal(res.statusCode, 409);
  assert.equal(spaced(res.body.error), `Remboursements du ${frDay} (50,00 €), du ${frDay} (100,00 €) à supprimer d’abord.`);
  assert.equal(res.body.refundIds.length, 2);
});

test('what stays collected covers the refund: the un-tick passes', () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  pay(stay.id, D, S);
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 50 }]).statusCode, 201);
  assert.equal(mark(stay.id, { balancePaid: false }).statusCode, 200);
  assert.equal(register(stay.id).collectedTtc, Math.round((rowOf(stay.id).depositAmount - 50) * 100) / 100);
});

test('a caisse-interne refund is off the books: it blocks nothing', () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 100 }], 'internal').statusCode, 201);
  assert.equal(mark(stay.id, { balancePaid: false }).statusCode, 200);
});

function settle(id, mode) {
  const res = respond();
  controller.settleArrivalPayment({ params: { id }, body: { mode, date: TODAY }, user: ADMIN }, res);
  return res;
}

test('arrival undo with a refund open: refused, whole group kept, then accepted once deleted', () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  assert.equal(settle(stay.id, 'card').statusCode, 200);
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 100 }]).statusCode, 201);
  const res = settle(stay.id, 'undo');
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, CODE);
  assert.equal(rowOf(stay.id).balancePaid, 1);
  assert.ok(rowOf(stay.id).arrivalPaymentGroup);
  deleteRefund(stay.id, lastRefundId(stay.id));
  assert.equal(settle(stay.id, 'undo').statusCode, 200);
  assert.equal(rowOf(stay.id).balancePaid, 0);
});

// Rule 52 reading (audit R23 L6): the adjustment lowers what stays collected too.
async function saveCode(stay, over) {
  const res = respond();
  await controller.update({ params: { id: stay.id }, body: { ...stay.body, ...over, forceOverpayment: true }, user: ADMIN }, res);
  return { status: res.statusCode, code: res.body.code };
}

test('a paid complement adjusted down below the refund: 409, the amount stays; with the refund gone it passes', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(stay.id, C);
  assert.equal(refund(stay.id, [{ key: 'custom:forcée', amountTtc: 50 }]).statusCode, 201);
  assert.deepEqual(await saveCode(stay, { complementAmountOverride: 10 }), { status: 409, code: CODE });
  assert.equal(rowOf(stay.id).complementAmount, 50);
  deleteRefund(stay.id, lastRefundId(stay.id));
  assert.equal((await saveCode(stay, { complementAmountOverride: 10 })).status, 200);
  assert.equal(rowOf(stay.id).complementAmount, 10);
});

test('a paid end-of-stay complement adjusted down below the refund: the same 409', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  pay(stay.id, { endOfStayComplementPaid: true, endOfStayComplementPaidDate: TODAY });
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 600 }]).statusCode, 201);
  assert.equal(refund(stay.id, [{ key: 'custom:forcée', amountTtc: 20 }]).statusCode, 201);
  assert.equal(refund(stay.id, [{ label: 'Geste', bucket: 'options', amountTtc: 30 }]).statusCode, 201);
  assert.deepEqual(await saveCode(stay, { endOfStayComplementAmountOverride: 2 }), { status: 409, code: CODE });
  assert.equal(rowOf(stay.id).endOfStayComplementAmount, 42.4);
});

test('an adjustment above the refund, and one on an unpaid complement, pass', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(stay.id, S, C);
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 10 }]).statusCode, 201);
  assert.equal((await saveCode(stay, { complementAmountOverride: 30 })).status, 200);
  const unpaid = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(unpaid.id, S);
  assert.equal(refund(unpaid.id, [{ key: ACCOMMODATION, amountTtc: 10 }]).statusCode, 201);
  assert.equal((await saveCode(unpaid, { complementAmountOverride: 5 })).status, 200);
});

// Audit R23 L2 — three lines of the guard no test held.
test('a gesture that does not lower what is collected passes on a stored negative', () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 300 }]).statusCode, 201);
  db.prepare('UPDATE reservations SET balancePaid = 0 WHERE id = ?').run(stay.id);
  assert.equal(mark(stay.id, { cautionReceived: true, cautionReceivedDate: TODAY }).statusCode, 200);
  assert.equal(mark(stay.id, S).statusCode, 200);
});

function stayWithNote() {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(30, 'Note')] });
  const notes = [{ id: 1, total: 30, paidDate: TODAY, paidCash: 0, lines: [{ key: 'custom:note', amount: 30, label: 'Note' }] }];
  db.prepare('UPDATE reservations SET midStaySettledNotes = ? WHERE id = ?').run(JSON.stringify(notes), stay.id);
  assert.equal(refund(stay.id, [{ key: 'custom:note', amountTtc: 30 }]).statusCode, 201);
  return stay;
}

test('a note cancelled under its refund: refused', () => {
  refuses(stayWithNote().id, { cancelMidStayNote: { id: 1 } }, '30,00');
});

test('a note lowered under its refund: refused', () => {
  refuses(stayWithNote().id, { adjustMidStayNote: { id: 1, total: 10 } }, '30,00');
});

test('a note moved to the caisse interne under its refund: refused', () => {
  refuses(stayWithNote().id, { adjustMidStayNote: { id: 1, cash: true } }, '30,00');
});

test('a deferred complement un-ticked takes its end of stay too: what stays is judged without both', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  db.prepare('UPDATE reservations SET complementDeferredToCheckout = 1, endOfStayComplementPaid = 1, endOfStayComplementPaidDate = ? WHERE id = ?').run(TODAY, stay.id);
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 600 }]).statusCode, 201);
  assert.equal(refund(stay.id, [{ key: 'custom:forcée', amountTtc: 20 }]).statusCode, 201);
  const res = mark(stay.id, { complementPaid: false });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, CODE);
});
