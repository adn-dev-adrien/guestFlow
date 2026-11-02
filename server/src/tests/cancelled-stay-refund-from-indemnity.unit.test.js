// specs/reservation-refunds.md rule 48 and specs/payment-schedule-and-cancellation.md rule 31, reading of
// 2026-11-02 (audit R14-M1, Adrien's decision « Réduire l'indemnité »). A cancellation moves the money it kept
// out of 706 + VAT into the indemnity (75880000, 0 %). A manual refund on that stay used to be booked like the
// refund of a live sale: it debited 706 and 4457 again — negative revenue and deductible VAT on money whose VAT
// was already reversed — and left the indemnity whole. The register also offered the never-collected part of
// the stay. Now: only money collected can go back; the part not requalified (a paid solde) keeps its 706 + VAT
// treatment, the rest is taken from the indemnity.
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

// Stay #22326, anonymised: 3 053,60 € with 1 054 € of options and 36 € of tax, in 1 030 + 1 030 + 1 029,60 €.
// Two installments paid by transfer, then cancelled: 2 060 € kept as an indemnity.
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

// Σ debit − credit per account over the month: encaissements, refunds, indemnity.
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

test('rule 48 — a cancelled plan offers what the installments collected, never the unpaid remainder', () => {
  const { deps } = seedPlan();
  cancel(deps);
  const register = call(controllerOf(deps).list).body;
  const byKey = Object.fromEntries(register.refundableLines.map((l) => [l.key, l]));
  assert.equal(byKey.accommodation.refundableTtc, 1333.24, 'two installments of 666,62 € of accommodation');
  assert.equal(byKey['opt:1'].refundableTtc, 702.76);
  assert.equal(byKey.touristTax.refundableTtc, 24);
  assert.equal(round2(register.refundableLines.reduce((t, l) => t + l.refundableTtc, 0)), 2060, 'Σ = what was collected');
  assert.equal(register.collectedTtc, 2060);
});

test('rule 48 — refunding 500 € of a cancelled plan reduces the indemnity: 706 and 4457 stay at 0', { skip: skipWithout(['accounting-export']) }, () => {
  const { db, deps } = seedPlan();
  cancel(deps);
  const out = refund(controllerOf(deps), [{ key: 'accommodation', amountTtc: 500 }]);
  assert.equal(out.statusCode, 201, JSON.stringify(out.body));
  const net = netByAccount(db);
  for (const account of Object.keys(net).filter((a) => /^(706|445|467)/.test(a))) {
    assert.equal(net[account], 0, `${account} nets to zero`);
  }
  assert.equal(net['75880000'], -1560, 'the indemnity is reduced by the 500 € given back');
  assert.equal(net.CTEST, 1560, 'the client account carries what was kept');
  assert.equal(out.body.collectedTtc, 1560);
  assert.equal(out.body.refundableLines.find((l) => l.key === 'accommodation').refundableTtc, 833.24);
});

test('rule 48 — on a cancelled stay, a refund above what was collected is refused', () => {
  const { deps } = seedPlan();
  cancel(deps);
  const controller = controllerOf(deps);
  const tooMuchOnLine = refund(controller, [{ key: 'accommodation', amountTtc: 1333.25 }]);
  assert.equal(tooMuchOnLine.statusCode, 409);
  assert.equal(tooMuchOnLine.body.code, 'REFUND_EXCEEDS_LINE');
  const tooMuchFree = refund(controller, [{ label: 'Geste', bucket: 'options', amountTtc: 2060.01 }]);
  assert.equal(tooMuchFree.statusCode, 409);
  assert.equal(tooMuchFree.body.code, 'REFUND_EXCEEDS_COLLECTED');
  assert.equal(refund(controller, [{ label: 'Geste', bucket: 'options', amountTtc: 2060 }]).statusCode, 201, 'everything collected can go back');
  const after = refund(controller, [{ label: 'Geste', bucket: 'options', amountTtc: 0.01 }]);
  assert.equal(after.statusCode, 409);
  assert.equal(after.body.code, 'REFUND_EXCEEDS_COLLECTED');
});

test('rule 48 — the caisse interne cannot give back money the indemnity holds', () => {
  const { deps } = seedPlan();
  cancel(deps);
  const out = refund(controllerOf(deps), [{ key: 'accommodation', amountTtc: 100 }], 'internal');
  assert.equal(out.statusCode, 409);
  assert.equal(out.body.code, 'REFUND_INDEMNITY_OFF_BOOKS');
});

test('rule 48 — a retained acompte: refunding 200 € reduces the indemnity, 706 and 4457 stay at 0', { skip: skipWithout(['accounting-export']) }, () => {
  const { db, deps } = seedDeposit();
  cancel(deps);
  const controller = controllerOf(deps);
  const register = call(controller.list).body;
  assert.deepEqual(register.refundableLines.map((l) => [l.key, l.refundableTtc]), [['accommodation', 274]], 'the unpaid solde is not refundable');
  const out = refund(controller, [{ key: 'accommodation', amountTtc: 200 }]);
  assert.equal(out.statusCode, 201, JSON.stringify(out.body));
  const net = netByAccount(db);
  for (const account of Object.keys(net).filter((a) => /^(706|445)/.test(a))) {
    assert.equal(net[account], 0, `${account} nets to zero`);
  }
  assert.equal(net['75880000'], -74);
  assert.equal(net.CTEST, 74);
});

test('rule 48 — a paid solde keeps its 706 + VAT refund; only what exceeds it comes off the indemnity', { skip: skipWithout(['accounting-export']) }, () => {
  const { db, deps } = seedDeposit({ balancePaid: true });
  cancel(deps);
  const controller = controllerOf(deps);
  assert.equal(call(controller.list).body.collectedTtc, 914);
  const out = refund(controller, [{ key: 'accommodation', amountTtc: 700 }]);
  assert.equal(out.statusCode, 201, JSON.stringify(out.body));
  const lines = out.body.refund.lines.map((l) => [l.bucket, l.amountTtc, l.vatRate]);
  assert.deepEqual(lines, [['accommodation', 640, 10], ['indemnity', 60, 0]]);
  const net = netByAccount(db);
  for (const account of Object.keys(net).filter((a) => /^(706|445)/.test(a))) {
    assert.equal(net[account], 0, `${account} nets to zero`);
  }
  assert.equal(net['75880000'], -214, '274 € kept, 60 € of it given back');
  assert.equal(net.CTEST, 214);
});
