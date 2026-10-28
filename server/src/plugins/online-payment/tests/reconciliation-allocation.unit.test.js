// specs/reconciliation-assisted-matching.md rules 5–9 — the allocation of ticked credits over a fiche's
// open receipts: first in first out, the preview's words, manual pairs and their refusals, an installment
// plan following its own order. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, addReservation, credit, build, reset, row } = require('./reconciliationFixture');
const { allocateFifo, summarize, validatePairs } = require('../reconciliation/allocation');
const sdk = require('../../sdk');

test.beforeEach(() => { reset(); db.prepare('DELETE FROM reservation_installments WHERE reservationId >= 100').run(); });

const at = (day) => `${day}T09:00:00.000Z`;
const stay = (over = {}) => addReservation({
  depositAmount: 300, depositDueDate: '2026-10-14', balanceAmount: 700, finalPrice: 1000, balanceDueDate: '2026-11-01', ...over,
});
const preview = (controller, body) => controller.previewAllocation(body).body;

const R = (ledgerKey, anchor, need, over = {}) => ({ key: `1|${ledgerKey}`, reservationId: 1, ledgerKey, label: ledgerKey, capCents: need, needCents: need, tolerance: 0, anchor, order: 0, ...over });
const C = (id, cents, settledAt) => ({ transactionId: id, remainingCents: cents, settledAt, dateLabel: settledAt.slice(8, 10) + '/' + settledAt.slice(5, 7) });

test('rule 5 — two credits settle an acompte first in first out, the oldest on the earliest due', () => {
  const credits = [C('b', 15000, '2026-10-20'), C('a', 15000, '2026-10-10')];
  const pairs = allocateFifo({ credits, receipts: [R('balance', '2026-11-01', 70000), R('deposit', '2026-10-14', 30000)] });
  assert.deepEqual(pairs.map((p) => [p.transactionId, p.ledgerKey, p.amountCents]), [['a', 'deposit', 15000], ['b', 'deposit', 15000]]);
});

test('rule 5 — a credit that fits one receipt to the cent goes there, not onto an earlier one', () => {
  const pairs = allocateFifo({ credits: [C('a', 70000, '2026-10-20')], receipts: [R('deposit', '2026-10-14', 30000), R('balance', '2026-11-01', 70000)] });
  assert.deepEqual(pairs.map((p) => [p.ledgerKey, p.amountCents]), [['balance', 70000]]);
});

test('rule 6 — a surplus stays on the last credit and is worded; a shortfall leaves the receipt partial', () => {
  const receipts = [R('deposit', '2026-10-14', 30000)];
  const over = [C('a', 20000, '2026-10-10'), C('b', 15000, '2026-10-12')];
  const pairs = allocateFifo({ credits: over, receipts });
  const sum = summarize({ credits: over, receipts, pairs });
  assert.deepEqual(sum.leftover.map((l) => [l.transactionId, l.cents]), [['b', 5000]]);
  assert.match(sum.leftover[0].message, /50,00 € restent disponibles sur le virement du 12\/10/);
  assert.equal(sum.receipts[0].after, 'covered');
  assert.equal(sum.summaryLabel, '2 virements · 300,00 €');

  const under = [C('a', 10000, '2026-10-10')];
  const sum2 = summarize({ credits: under, receipts, pairs: allocateFifo({ credits: under, receipts }) });
  assert.equal(sum2.receipts[0].after, 'partial');
  assert.match(sum2.receipts[0].statusLabel, /100,00 € sur 300,00 €/);
});

test('rule 5 — the preview over a real fiche: two credits cover the acompte and part of the solde, nothing is written', () => {
  const id = stay();
  const { controller, transactions, model } = build();
  transactions.upsertMany([
    credit('a', 20000, { settledAt: at('2026-10-10') }), credit('b', 25000, { settledAt: at('2026-10-12') }),
  ], { bankAccountId: 'acc-1' });
  const body = preview(controller, { reservationId: id, transactionIds: ['b', 'a'] });
  assert.equal(body.valid, true);
  assert.deepEqual(body.pairs.map((p) => [p.transactionId, p.ledgerKey, p.amountCents]), [['a', 'deposit', 20000], ['b', 'deposit', 10000], ['b', 'balance', 15000]]);
  assert.deepEqual(body.receipts.map((r) => [r.key.split('|')[1], r.after]), [['deposit', 'covered'], ['balance', 'partial']]);
  assert.equal(body.summaryLabel, '2 virements · 450,00 €');
  assert.equal(model.listLines().length, 0, 'a preview never writes');
});

test('rule 7 — manual pairs are refused above the credit, above the receipt, at zero and with 3 decimals', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([credit('a', 20000, { settledAt: at('2026-10-10') })], { bankAccountId: 'acc-1' });
  const check = (amountCents) => preview(controller, { pairs: [{ transactionId: 'a', reservationId: id, ledgerKey: 'deposit', amountCents }] });
  assert.equal(check(15000).valid, true);
  assert.equal(check(20001).errors[0].code, 'ALLOCATION_EXCEEDS_TRANSACTION');
  assert.match(check(20001).errors[0].message, /n'a plus que 200,00 €/);
  assert.equal(preview(controller, { pairs: [{ transactionId: 'a', reservationId: id, ledgerKey: 'deposit', amountCents: 20000 }, { transactionId: 'a', reservationId: id, ledgerKey: 'balance', amountCents: 1 }] }).errors[0].code, 'ALLOCATION_EXCEEDS_TRANSACTION');
  assert.equal(check(0).errors[0].code, 'INVALID_ALLOCATION');
  assert.equal(check(-5).valid, false);
  assert.equal(check(100.5).errors[0].code, 'INVALID_ALLOCATION', 'cents are whole numbers: no third decimal');
});

test('rule 7 — a pair above what the receipt still expects is refused, not a platform payout not yet recorded', () => {
  const receipts = new Map([['1|deposit', R('deposit', '2026-10-14', 30000)]]);
  const creditsById = new Map([['a', { transactionId: 'a', remainingCents: 90000, dateLabel: '10/10' }]]);
  const errs = validatePairs({ pairs: [{ transactionId: 'a', reservationId: 1, ledgerKey: 'deposit', amountCents: 40000 }], creditsById, receiptsByKey: receipts });
  assert.equal(errs[0].code, 'ALLOCATION_EXCEEDS_RECEIPT');
  receipts.get('1|deposit').unbounded = true;
  assert.deepEqual(validatePairs({ pairs: [{ transactionId: 'a', reservationId: 1, ledgerKey: 'deposit', amountCents: 40000 }], creditsById, receiptsByKey: receipts }), []);
});

test('rule 9 — equal installments take the earliest due unpaid one, whatever the credit date', () => {
  const id = addReservation({ finalPrice: 1000, depositAmount: 0, balanceAmount: 0 });
  sdk.coreModule('installmentsModel').buildModel(db).replacePlan(id, [
    { number: 1, dueDate: '2026-10-01', amountCents: 33400 }, { number: 2, dueDate: '2026-10-20', amountCents: 33400 }, { number: 3, dueDate: '2026-11-05', amountCents: 33200 },
  ], 100000);
  const { controller, transactions } = build();
  transactions.upsertMany([credit('late', 33400, { settledAt: at('2026-10-22') })], { bankAccountId: 'acc-1' });
  const body = preview(controller, { reservationId: id, transactionIds: ['late'] });
  assert.deepEqual(body.pairs.map((p) => p.ledgerKey), ['installment-1']);
});

test('rule 9 — an installment already reconciled takes no more money', () => {
  const id = addReservation({ finalPrice: 1000, depositAmount: 0, balanceAmount: 0 });
  sdk.coreModule('installmentsModel').buildModel(db).replacePlan(id, [
    { number: 1, dueDate: '2026-10-01', amountCents: 33400 }, { number: 2, dueDate: '2026-10-20', amountCents: 33400 },
  ], 66800);
  const { controller, transactions, model } = build();
  transactions.upsertMany([credit('first', 33400, { settledAt: at('2026-10-02') }), credit('second', 33400, { settledAt: at('2026-10-21') })], { bankAccountId: 'acc-1' });
  model.addLine({ transactionId: 'first', reservationId: id, ledgerKey: 'installment-1', amountCents: 33400 });
  const body = preview(controller, { reservationId: id, transactionIds: ['second'] });
  assert.deepEqual(body.pairs.map((p) => p.ledgerKey), ['installment-2']);
});

test('rule 8 — a payout the fiche does not carry yet takes the whole credit', () => {
  const id = addReservation({ platform: 'Booking', finalPrice: 800, platformGrossAmount: 800, balanceAmount: 800, depositAmount: 0 });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('p', 67000, { settledAt: at('2026-10-20') })], { bankAccountId: 'acc-1' });
  const body = preview(controller, { reservationId: id, transactionIds: ['p'] });
  assert.deepEqual(body.pairs.map((p) => p.amountCents), [67000]);
  assert.equal(body.receipts[0].after, 'covered');
  assert.equal(row(id).balancePaid, 0);
});

test('rule 5 — the preview refuses an unknown credit and more than 10 credits', () => {
  const id = stay();
  const { controller } = build();
  assert.equal(controller.previewAllocation({ reservationId: id, transactionIds: ['nope'] }).status, 404);
  const many = Array.from({ length: 11 }, (_, i) => `t${i}`);
  assert.equal(controller.previewAllocation({ reservationId: id, transactionIds: many }).status, 422);
});
