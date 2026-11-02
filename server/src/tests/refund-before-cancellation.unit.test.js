// specs/payment-schedule-and-cancellation.md rule 55 (2026-11-02, review of PR #925, finding 3). A book refund made
// BEFORE the cancellation already took its money out of 706 + VAT (or 4671). The cancellation used to requalify the
// gross acompte / installments anyway: acompte 274 €, 100 € of accommodation given back, cancel → 274 € kept as an
// indemnity although 174 € were held; once the 174 € still offered went back, 70600000 +90,91, 44571100 +9,09 and
// 75880000 −100 stayed in the books. Now the cancellation keeps, bucket by bucket and installment line by
// installment line, what the book refunds left of it — after a paid solde has absorbed them first.
// specs/reservation-refunds.md rule 49 — the lines a cancelled stay offers never add up to more than it can still
// give back, and a refusal names what is really left.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { cancelReservation } = require('../utils/cancelReservation');
const { recordInstallmentPayment } = require('../utils/installmentPayment');
const { migrateInstallmentsSchema } = require('../utils/installmentsMigration');
const { localIsoDate } = require('../utils/localDate');
const reservationsModelFactory = require('../models/reservationsModel');
const refundsModelFactory = require('../models/refundsModel');
const compensationsModelFactory = require('../models/cancellationCompensationsModel');
const paymentLinksModelFactory = require('../models/paymentLinksModel');
const { buildModel: buildInstallmentsModel } = require('../models/installmentsModel');
const { createController: createRefundsController } = require('../controllers/refundsController');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const { create: createAccountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { entryToStructured } = optionalPlugin(() => require('../plugins/accounting-export/accountingExport'));

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localIsoDate(d); };
const TODAY = inDays(0);
const round2 = (n) => Math.round(n * 100) / 100;
const sum = (list) => round2(list.reduce((t, n) => t + n, 0));
const accounting = { skip: skipWithout(['accounting-export']) };

function depsOf(db, installmentsModel = null) {
  return {
    database: db,
    reservationsModel: reservationsModelFactory.create(db),
    refundsModel: refundsModelFactory.createModel(db),
    compensationsModel: compensationsModelFactory.buildModel(db),
    paymentLinksModel: paymentLinksModelFactory.buildModel(db),
    installmentsModel,
  };
}

function baseDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  migrateInstallmentsSchema(db);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte Test')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Test')").run();
  return db;
}

// The shape of stay #22326, anonymised: 3 053,60 € with 1 054 € of options and 36 € of tax, in
// 1 030 + 1 030 + 1 029,60 €. Two installments paid by transfer.
function seedPlan() {
  const db = baseDb();
  db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (1, 'Dîner', 1054, 'fixed')").run();
  db.prepare(`
    INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, checkInTime, checkOutTime, platform,
      finalPrice, totalPrice, touristTaxTotal, depositAmount, depositPaid, balanceAmount, balancePaid)
    VALUES (10, 'reservation', 1, 1, ?, ?, '15:00', '10:00', 'direct', 3053.6, 3053.6, 36, 0, 0, 0, 0)
  `).run(inDays(60), inDays(63));
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice) VALUES (10, 1, 1, 1054)').run();
  const installmentsModel = buildInstallmentsModel(db);
  const plan = installmentsModel.replacePlan(10, [
    { number: 1, dueDate: inDays(1), amountCents: 103000 },
    { number: 2, dueDate: inDays(20), amountCents: 103000 },
    { number: 3, dueDate: inDays(40), amountCents: 102960 },
  ], 308960);
  plan.slice(0, 2).forEach((i) => recordInstallmentPayment({ db }, { installmentId: i.id, paidDate: TODAY, method: 'transfer' }));
  return { db, deps: depsOf(db, installmentsModel) };
}

// A direct stay of 914 €: acompte 274 € paid, solde 640 € paid or not.
function seedDeposit({ balancePaid = false } = {}) {
  const db = baseDb();
  db.prepare(`
    INSERT INTO reservations
      (id, kind, propertyId, clientId, startDate, endDate, platform,
       finalPrice, totalPrice, depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balancePaidDate, balanceDueDate)
    VALUES (10, 'reservation', 1, 1, ?, ?, 'direct', 914, 914, 274, 1, ?, 640, ?, ?, ?)
  `).run(inDays(60), inDays(67), TODAY, balancePaid ? 1 : 0, balancePaid ? TODAY : null, inDays(30));
  return { db, deps: depsOf(db) };
}

function controllerOf(deps) {
  return createRefundsController({
    refundsModel: deps.refundsModel,
    reservationsModel: deps.reservationsModel,
    vatRateOf: () => 10,
    storedOverpaymentTtc: () => 0,
  });
}

function call(handler, body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  handler({ params: { id: '10' }, body }, res);
  return res;
}

const cancel = (deps) => cancelReservation(deps, 10, { today: TODAY, vatRate: 10, reason: 'Solde jamais réglé' });
const refund = (controller, lines, method = 'transfer') => call(controller.create, { refundDate: TODAY, method, lines });
const registerOf = (controller) => call(controller.list).body;
const retainedOf = (register) => register.refunds.find((r) => r.method === 'retained');

// Give back every line the register offers, one refund per line, and require each to be accepted.
function giveBackAll(controller) {
  for (const line of registerOf(controller).refundableLines) {
    const out = refund(controller, [{ key: line.key, amountTtc: line.refundableTtc }]);
    assert.equal(out.statusCode, 201, `${line.key} ${line.refundableTtc}: ${JSON.stringify(out.body)}`);
  }
  const after = registerOf(controller);
  assert.deepEqual(after.refundableLines, [], 'nothing left to offer');
  assert.equal(after.collectedTtc, 0);
}

function netByAccount(db) {
  const [year, month] = TODAY.split('-').map(Number);
  const model = createAccountingModel(db);
  const entries = [
    ...model.encaissementsByMonth({ month, year }),
    ...model.refundsByMonth({ month, year }),
    ...model.compensationsByMonth({ month, year }),
  ];
  const net = {};
  for (const entry of entries) {
    for (const line of entryToStructured(entry).lines) {
      net[line.compte] = round2((net[line.compte] || 0) + Number(line.debit || 0) - Number(line.credit || 0));
    }
  }
  return net;
}

function assertSalesAccountsAtZero(net) {
  for (const account of Object.keys(net).filter((a) => /^(706|445|467)/.test(a))) {
    assert.equal(net[account], 0, `${account} nets to zero`);
  }
}

test('payment-schedule rule 55 — acompte 274 €, 100 € given back, then cancelled: 174 € are kept, not 274 €', () => {
  const { deps } = seedDeposit();
  const controller = controllerOf(deps);
  assert.equal(refund(controller, [{ key: 'accommodation', amountTtc: 100 }]).statusCode, 201);
  const out = cancel(deps);
  assert.equal(out.ok, true);
  assert.equal(out.retainedDepositAmount, 174);
  const register = registerOf(controller);
  const retained = retainedOf(register);
  assert.equal(retained.totalTtc, 174);
  assert.deepEqual(retained.lines.map((l) => [l.bucket, l.amountTtc]), [['accommodation', 174]]);
  const card = deps.database.prepare('SELECT receivedAmount FROM cancellation_compensations WHERE reservationId = 10').get();
  assert.equal(card.receivedAmount, 174, 'the indemnity card holds what was really kept');
  assert.deepEqual(register.refundableLines.map((l) => [l.key, l.refundableTtc]), [['accommodation', 174]]);
});

test('payment-schedule rule 55 — refund before, cancel, give back the rest: every sales account and 7588 net to 0', accounting, () => {
  const { db, deps } = seedDeposit();
  const controller = controllerOf(deps);
  assert.equal(refund(controller, [{ key: 'accommodation', amountTtc: 100 }]).statusCode, 201);
  cancel(deps);
  const kept = netByAccount(db);
  assertSalesAccountsAtZero(kept);
  assert.equal(kept['75880000'], -174, 'the indemnity is what was held at the cancellation');
  giveBackAll(controller);
  const net = netByAccount(db);
  assertSalesAccountsAtZero(net);
  assert.equal(net['75880000'] || 0, 0);
  assert.equal(net.CTEST || 0, 0);
});

test('payment-schedule rule 55 — a paid solde absorbs the earlier refund first: the acompte is kept whole', accounting, () => {
  const { db, deps } = seedDeposit({ balancePaid: true });
  const controller = controllerOf(deps);
  assert.equal(refund(controller, [{ key: 'accommodation', amountTtc: 100 }]).statusCode, 201);
  assert.equal(cancel(deps).retainedDepositAmount, 274);
  giveBackAll(controller);
  const net = netByAccount(db);
  assertSalesAccountsAtZero(net);
  assert.equal(net['75880000'] || 0, 0);
  assert.equal(net.CTEST || 0, 0);
});

test('payment-schedule rule 55 — a plan: 100 € given back before the cancellation, 1 960 € are kept', () => {
  const { deps } = seedPlan();
  const controller = controllerOf(deps);
  assert.equal(refund(controller, [{ key: 'accommodation', amountTtc: 100 }]).statusCode, 201);
  assert.equal(cancel(deps).retainedDepositAmount, 1960);
  const register = registerOf(controller);
  assert.equal(retainedOf(register).totalTtc, 1960);
  assert.equal(sum(retainedOf(register).lines.map((l) => l.amountTtc)), 1960);
  assert.equal(register.collectedTtc, 1960);
  assert.equal(sum(register.refundableLines.map((l) => l.refundableTtc)), 1960);
});

test('payment-schedule rule 55 — a plan, awkward refunds on every bucket before the cancellation: all accounts net to 0', accounting, () => {
  const { db, deps } = seedPlan();
  const controller = controllerOf(deps);
  const pre = refund(controller, [
    { key: 'accommodation', amountTtc: 100.05 },
    { key: 'opt:1', amountTtc: 33.37 },
    { key: 'touristTax', amountTtc: 6 },
  ]);
  assert.equal(pre.statusCode, 201, JSON.stringify(pre.body));
  assert.equal(refund(controller, [{ key: 'accommodation', amountTtc: 0.07 }]).statusCode, 201);
  assert.equal(cancel(deps).retainedDepositAmount, round2(2060 - 100.05 - 33.37 - 6 - 0.07));
  const kept = netByAccount(db);
  assertSalesAccountsAtZero(kept);
  giveBackAll(controller);
  const net = netByAccount(db);
  assertSalesAccountsAtZero(net);
  assert.equal(net['75880000'] || 0, 0);
  assert.equal(net.CTEST || 0, 0);
});

test('payment-schedule rule 55 — a refund of the whole acompte before the cancellation leaves nothing to requalify', () => {
  const { deps } = seedDeposit();
  const controller = controllerOf(deps);
  assert.equal(refund(controller, [{ key: 'accommodation', amountTtc: 274 }]).statusCode, 201);
  const out = cancel(deps);
  assert.equal(out.retainedDepositAmount, 0);
  assert.equal(out.refundId, null);
  assert.equal(out.compensationId, null);
});

test('payment-schedule rule 55 — the caisse interne is off the books: it does not reduce what the cancellation requalifies', () => {
  const { deps } = seedDeposit();
  const controller = controllerOf(deps);
  assert.equal(refund(controller, [{ key: 'accommodation', amountTtc: 100 }], 'internal').statusCode, 201);
  assert.equal(cancel(deps).retainedDepositAmount, 274);
});

test('reservation-refunds rule 49 — after a free line, the offered lines never add up to more than is left', () => {
  const { deps } = seedPlan();
  cancel(deps);
  const controller = controllerOf(deps);
  const mixed = refund(controller, [
    { key: 'accommodation', amountTtc: 400 },
    { key: 'opt:1', amountTtc: 100.55 },
    { key: 'touristTax', amountTtc: 12 },
    { label: 'Geste', bucket: 'options', amountTtc: 10 },
  ]);
  assert.equal(mixed.statusCode, 201, JSON.stringify(mixed.body));
  const register = registerOf(controller);
  assert.equal(register.collectedTtc, 1537.45);
  assert.equal(sum(register.refundableLines.map((l) => l.refundableTtc)), 1537.45, 'Σ offered = what is left');
  const all = refund(controller, register.refundableLines.map((l) => ({ key: l.key, amountTtc: l.refundableTtc })));
  assert.equal(all.statusCode, 201, JSON.stringify(all.body));
  assert.equal(registerOf(controller).collectedTtc, 0);
});

test('reservation-refunds rule 49 — a refusal names what is really left, never the line it ran out on', () => {
  const { deps } = seedPlan();
  cancel(deps);
  const controller = controllerOf(deps);
  assert.equal(refund(controller, [{ label: 'Geste', bucket: 'options', amountTtc: 2050 }]).statusCode, 201);
  const register = registerOf(controller);
  assert.equal(register.collectedTtc, 10);
  assert.equal(sum(register.refundableLines.map((l) => l.refundableTtc)), 10);
  assert.deepEqual(register.refundableLines.map((l) => [l.key, l.refundableTtc]), [['touristTax', 10]]);
  const tax = refund(controller, [{ key: 'touristTax', amountTtc: 12 }]);
  assert.equal(tax.statusCode, 409);
  assert.equal(tax.body.code, 'REFUND_EXCEEDS_LINE');
  assert.match(tax.body.error, /\(10,00\u00a0€\)/, 'the 10 € left, not the 12 € the tax line once held');
  const overall = refund(controller, [{ key: 'touristTax', amountTtc: 6 }, { label: 'Geste', bucket: 'options', amountTtc: 5 }]);
  assert.equal(overall.statusCode, 409);
  assert.equal(overall.body.code, 'REFUND_EXCEEDS_COLLECTED');
  assert.equal(overall.body.error, 'Dépasse l’encaissé (10,00\u00a0€).');
});

test('reservation-refunds rule 49 — a paid solde: the lines share the sale money, their sum stays what was collected', () => {
  const db = baseDb();
  db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (1, 'Dîner', 100, 'fixed')").run();
  db.prepare(`
    INSERT INTO reservations
      (id, kind, propertyId, clientId, startDate, endDate, platform,
       finalPrice, totalPrice, depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balancePaidDate, balanceDueDate)
    VALUES (10, 'reservation', 1, 1, ?, ?, 'direct', 914, 914, 274, 1, ?, 640, 1, ?, ?)
  `).run(inDays(60), inDays(67), TODAY, TODAY, inDays(30));
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice) VALUES (10, 1, 1, 100)').run();
  const deps = depsOf(db);
  cancel(deps);
  const controller = controllerOf(deps);
  const register = registerOf(controller);
  assert.equal(register.collectedTtc, 914);
  assert.equal(sum(register.refundableLines.map((l) => l.refundableTtc)), 914);
  const all = refund(controller, register.refundableLines.map((l) => ({ key: l.key, amountTtc: l.refundableTtc })));
  assert.equal(all.statusCode, 201, JSON.stringify(all.body));
});
