// specs/mixed-method-payments.md rules 44, 46 (audit R34-M-M1 / R34-S1) — the acompte and the installments are the
// money a cancellation keeps and requalifies (payment-schedule-and-cancellation rule 55, D8): paid with several methods,
// they go on the books whole or in the caisse whole, for their whole amount. And a solde paid partly in the caisse
// interne gives its caisse share back in the caisse interne once the stay is cancelled.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, ADMIN, TODAY, rowOf, mark, NO_ACOMPTE, WITH_ACOMPTE, D, fiche, pay, cancel, register, refund, respond,
} = require('./moneyLedgerFixture');
const controller = require('../controllers/reservationsController');
const settlementsController = require('../controllers/paymentSettlementsController');
const installmentsController = require('../controllers/installmentsController');
const installmentsModel = require('../models/installmentsModel');
const settlementsModel = require('../models/paymentSettlementsModel');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const { create: createAccountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { entryToStructured } = optionalPlugin(() => require('../plugins/accounting-export/accountingExport'));
const BOOKS = { skip: skipWithout(['accounting-export']) };

const cents = (euros) => Math.round(Number(euros) * 100);
const round2 = (n) => Math.round(n * 100) / 100;
const cashIn = (amountCents) => ({ method: 'cash', amountCents, internal: true });
const card = (amountCents) => ({ method: 'card', amountCents, internal: false });
const transfer = (amountCents) => ({ method: 'transfer', amountCents, internal: false });

function call(handler, params, body) {
  const res = respond();
  handler({ params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), body, user: ADMIN }, res);
  return res;
}

// Every account the stay moved this month, netted: encaissements, refunds and the cancellation's compensation.
function netByAccount() {
  const [year, month] = TODAY.split('-').map(Number);
  const model = createAccountingModel(db);
  const net = {};
  for (const e of [...model.encaissementsByMonth({ month, year }), ...model.refundsByMonth({ month, year }), ...model.compensationsByMonth({ month, year })]) {
    for (const l of entryToStructured(e).lines) net[l.compte] = round2((net[l.compte] || 0) + Number(l.debit || 0) - Number(l.credit || 0));
  }
  return net;
}

function acompteStay() {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  return { ...stay, due: cents(rowOf(stay.id).depositAmount) };
}
const payDeposit = (stay, tenders, shortfall) => mark(stay.id, {
  depositPaid: true, depositPaidDate: TODAY, expectedAmountCents: stay.due, tenders, ...(shortfall ? { shortfall } : {}),
});

test('specs/mixed-method-payments.md rule 44 — an acompte split between the caisse interne and the books: refused, nothing written', () => {
  const stay = acompteStay();
  const res = payDeposit(stay, [cashIn(5000), transfer(stay.due - 5000)]);
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.error, 'Acompte : tout en compta ou tout en caisse interne.');
  assert.equal(res.body.field, 'tenders');
  assert.equal(rowOf(stay.id).depositPaid, 0);
  assert.equal(settlementsModel.listFor(stay.id).length, 0);
});

test('specs/mixed-method-payments.md rule 44 — an acompte with a reste or a geste commercial: refused', () => {
  for (const kind of ['due', 'waived']) {
    const stay = acompteStay();
    const res = payDeposit(stay, [card(stay.due - 7400)], { kind });
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, 'Acompte : le montant entier, sans reste ni geste.');
    assert.equal(rowOf(stay.id).depositPaid, 0);
  }
});

test('specs/mixed-method-payments.md rule 44 — an acompte on the books whole (CB + virement), then cancelled: the books net to the indemnity', BOOKS, async () => {
  const before = netByAccount();
  const stay = acompteStay();
  assert.equal(payDeposit(stay, [card(5000), transfer(stay.due - 5000)]).statusCode, 200);
  await cancel(stay.id);
  const after = netByAccount();
  const moved = (account) => round2((after[account] || 0) - (before[account] || 0));
  assert.equal(moved('70600000'), 0, JSON.stringify(after));
  assert.equal(moved('44571100'), 0, JSON.stringify(after));
  assert.equal(moved('75880000'), -stay.due / 100, JSON.stringify(after));
});

test('specs/mixed-method-payments.md rule 44 — an acompte in the caisse whole: stored as « Caisse interne », never requalified (D8)', BOOKS, async () => {
  const before = netByAccount();
  const stay = acompteStay();
  assert.equal(payDeposit(stay, [cashIn(stay.due)]).statusCode, 200);
  assert.equal(rowOf(stay.id).depositPaidCash, 1);
  await cancel(stay.id);
  assert.deepEqual(netByAccount(), before);
});

test('specs/mixed-method-payments.md rule 44 — the single arrival payment carrying the acompte: the same refusal', () => {
  const stay = acompteStay();
  const r = rowOf(stay.id);
  const due = cents(r.depositAmount) + cents(r.balanceAmount);
  const res = call(controller.settleArrivalPayment, { id: stay.id }, { mode: 'split', date: TODAY, expectedAmountCents: due, tenders: [cashIn(5000), card(due - 5000)] });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.error, 'Acompte : tout en compta ou tout en caisse interne.');
  assert.equal(rowOf(stay.id).depositPaid, 0);
});

test('specs/mixed-method-payments.md rule 44 — a correction cannot bring the caisse interne into a split acompte', () => {
  const stay = acompteStay();
  assert.equal(payDeposit(stay, [card(5000), transfer(stay.due - 5000)]).statusCode, 200);
  const [s] = settlementsModel.listFor(stay.id);
  const res = call(settlementsController.modify, { id: stay.id, settlementId: s.id }, { date: TODAY, tenders: [cashIn(5000), transfer(stay.due - 5000)] });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.error, 'Acompte : tout en compta ou tout en caisse interne.');
});

test('specs/mixed-method-payments.md rule 44 — an installment: no caisse interne, no reste, no geste', () => {
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice)
    VALUES (?, 1, date(?, '+700 day'), date(?, '+702 day'), 'direct', 2, 600)`).run(NO_ACOMPTE, TODAY, TODAY).lastInsertRowid);
  const [first] = installmentsModel.replacePlan(id, [
    { number: 1, dueDate: TODAY, amountCents: 30000 }, { number: 2, dueDate: TODAY, amountCents: 30000 },
  ], 60000);
  const pay1 = (body) => call(installmentsController.markPaid, { id, installmentId: first.id }, { paidDate: TODAY, ...body });
  const internal = pay1({ tenders: [cashIn(10000), card(20000)] });
  assert.equal(internal.statusCode, 400, JSON.stringify(internal.body));
  assert.equal(internal.body.message, 'Échéance : pas de caisse interne.');
  const short = pay1({ tenders: [card(20000)], shortfall: { kind: 'due' } });
  assert.equal(short.statusCode, 400);
  assert.equal(short.body.message, 'Échéance : le montant entier, sans reste ni geste.');
  assert.equal(installmentsModel.findById(first.id).paid, 0);
  assert.equal(pay1({ tenders: [{ method: 'cash', amountCents: 10000, internal: false }, card(20000)] }).statusCode, 200);
});

test('specs/mixed-method-payments.md rule 46 — a solde paid partly in the caisse interne, the stay cancelled: its caisse share goes back in the caisse', async () => {
  const stay = acompteStay();
  pay(stay.id, D);
  const solde = cents(rowOf(stay.id).balanceAmount);
  const res = mark(stay.id, { balancePaid: true, balancePaidDate: TODAY, expectedAmountCents: solde, tenders: [cashIn(14000), card(solde - 14000)] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  await cancel(stay.id);
  const reg = register(stay.id);
  const cashOffered = round2(reg.refundableLines.reduce((sum, line) => sum + Number(line.cashTtc || 0), 0));
  assert.equal(cashOffered, 140, JSON.stringify(reg.refundableLines));
  // The books offer what reached them: the solde's card share, never its 140 € in the caisse.
  const bookOffered = round2(reg.refundableLines.reduce((sum, line) => sum + line.refundableTtc - Number(line.cashTtc || 0), 0));
  assert.ok(bookOffered <= round2(rowOf(stay.id).depositAmount + (solde - 14000) / 100), String(bookOffered));
  const lines = reg.refundableLines.filter((l) => l.cashTtc > 0).map((l) => ({ key: l.key, amountTtc: l.cashTtc }));
  const back = refund(stay.id, lines, 'internal');
  assert.equal(back.statusCode, 201, JSON.stringify(back.body));
});

test('specs/mixed-method-payments.md rule 44 — the ledger tells the form: the acompte row is paid whole, the solde row is not', () => {
  const { ficheView } = require('./moneyLedgerFixture');
  const stay = acompteStay();
  const rows = ficheView(stay.id).ledger.rows;
  const deposit = rows.find((r) => r.key === 'deposit');
  const balance = rows.find((r) => r.key === 'balance');
  assert.equal(deposit.action.split.whole, true);
  assert.equal(balance.action.split.whole, undefined);
});
