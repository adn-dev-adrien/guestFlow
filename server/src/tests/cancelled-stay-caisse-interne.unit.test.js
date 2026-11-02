// specs/reservation-refunds.md rule 48 and specs/payment-schedule-and-cancellation.md rule 55, readings of 2026-11-02
// (audit R15-L1). Money collected in the caisse interne never reaches the books (encaissementsByMonth skips it), yet:
//   - the cancellation requalified a caisse-interne acompte as if it had been booked: 706 + 4457 debited on a sale
//     never booked, 7588 credited with money off the books (P1);
//   - the cancelled-stay register knew only the book money: a solde collected in the caisse interne could not be given
//     back at all (P2).
// Now the cancellation requalifies book money only, and the caisse interne has a budget of its own on the register —
// what it collected, less what it gave back — given back in the caisse interne only, as a pure sale share.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { cancelReservation } = require('../utils/cancelReservation');
const { migrateInstallmentsSchema } = require('../utils/installmentsMigration');
const { localIsoDate } = require('../utils/localDate');
const reservationsModelFactory = require('../models/reservationsModel');
const refundsModelFactory = require('../models/refundsModel');
const compensationsModelFactory = require('../models/cancellationCompensationsModel');
const paymentLinksModelFactory = require('../models/paymentLinksModel');
const { createController: createRefundsController } = require('../controllers/refundsController');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const { create: createAccountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { entryToStructured } = optionalPlugin(() => require('../plugins/accounting-export/accountingExport'));

const accounting = { skip: skipWithout(['accounting-export']) };
const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localIsoDate(d); };
const TODAY = inDays(0);
const round2 = (n) => Math.round(n * 100) / 100;

// A direct stay of 914 € that has started (the caisse interne is the arrival's): acompte 274 €, solde 640 €, each paid
// by transfer or in the caisse interne.
function seed({ depositCash = 0, balancePaid = 0, balanceCash = 0 } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  migrateInstallmentsSchema(db);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte Test')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Test')").run();
  db.prepare(`
    INSERT INTO reservations
      (id, kind, propertyId, clientId, startDate, endDate, platform, finalPrice, totalPrice,
       depositAmount, depositPaid, depositPaidDate, depositPaidCash, balanceAmount, balancePaid, balancePaidDate, balancePaidCash, balanceDueDate)
    VALUES (10, 'reservation', 1, 1, ?, ?, 'direct', 914, 914, 274, 1, ?, ?, 640, ?, ?, ?, ?)
  `).run(inDays(-1), inDays(6), TODAY, depositCash, balancePaid, balancePaid ? TODAY : null, balanceCash, inDays(30));
  const deps = {
    database: db,
    reservationsModel: reservationsModelFactory.create(db),
    refundsModel: refundsModelFactory.createModel(db),
    compensationsModel: compensationsModelFactory.buildModel(db),
    paymentLinksModel: paymentLinksModelFactory.buildModel(db),
  };
  const controller = createRefundsController({
    refundsModel: deps.refundsModel, reservationsModel: deps.reservationsModel, vatRateOf: () => 10, storedOverpaymentTtc: () => 0,
  });
  return { db, deps, controller };
}

function call(handler, body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  handler({ params: { id: '10' }, body }, res);
  return res;
}
const cancel = (deps) => cancelReservation(deps, 10, { today: TODAY, vatRate: 10 });
const refund = (controller, lines, method) => call(controller.create, { refundDate: TODAY, method, lines });
const registerOf = (controller) => call(controller.list).body;
const accommodationOf = (register) => register.refundableLines.find((line) => line.key === 'accommodation');

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
const nonZero = (net) => Object.fromEntries(Object.entries(net).filter(([, value]) => Math.abs(value) >= 0.005));

test('payment-schedule-and-cancellation rule 55 reading — an acompte collected in the caisse interne is not requalified (P1)', accounting, () => {
  const { db, deps } = seed({ depositCash: 1 });
  const out = cancel(deps);
  assert.equal(out.retainedDepositAmount, 0);
  assert.equal(out.refundId, null, 'no avoir');
  assert.equal(out.compensationId, null, 'no indemnity');
  assert.deepEqual(nonZero(netByAccount(db)), {}, 'nothing in the books: the acompte never was');
});

test('reservation-refunds rule 48 reading — a caisse-interne acompte goes back in the caisse interne only (P1)', accounting, () => {
  const { db, deps, controller } = seed({ depositCash: 1 });
  cancel(deps);
  const register = registerOf(controller);
  assert.equal(register.collectedTtc, 274);
  assert.equal(accommodationOf(register).refundableTtc, 274);
  assert.equal(accommodationOf(register).indemnityTtc, 0);
  assert.equal(accommodationOf(register).cashTtc, 274);
  const byTransfer = refund(controller, [{ key: 'accommodation', amountTtc: 274 }], 'transfer');
  assert.equal(byTransfer.statusCode, 409);
  assert.equal(byTransfer.body.code, 'REFUND_CASH_ONLY_IN_CASH');
  const inCash = refund(controller, [{ key: 'accommodation', amountTtc: 274 }], 'internal');
  assert.equal(inCash.statusCode, 201);
  assert.deepEqual(inCash.body.refund.lines.map((l) => [l.bucket, l.amountTtc]), [['accommodation', 274]]);
  assert.equal(inCash.body.collectedTtc, 0);
  assert.deepEqual(nonZero(netByAccount(db)), {});
});

test('reservation-refunds rule 48 reading — a solde collected in the caisse interne is offered beside the indemnity (P2)', accounting, () => {
  const { db, deps, controller } = seed({ balancePaid: 1, balanceCash: 1 });
  assert.equal(cancel(deps).retainedDepositAmount, 274, 'the transfer acompte is kept');
  const register = registerOf(controller);
  assert.equal(register.collectedTtc, 914);
  assert.deepEqual([accommodationOf(register).refundableTtc, accommodationOf(register).indemnityTtc, accommodationOf(register).cashTtc], [914, 274, 640]);

  const cash = refund(controller, [{ key: 'accommodation', amountTtc: 640 }], 'internal');
  assert.equal(cash.statusCode, 201);
  assert.deepEqual(cash.body.refund.lines.map((l) => [l.bucket, l.amountTtc]), [['accommodation', 640]]);
  const more = refund(controller, [{ key: 'accommodation', amountTtc: 100 }], 'internal');
  assert.equal(more.statusCode, 409);
  assert.equal(more.body.code, 'REFUND_INDEMNITY_OFF_BOOKS', 'what is left is the indemnity');
  const indemnity = refund(controller, [{ key: 'accommodation', amountTtc: 274 }], 'transfer');
  assert.equal(indemnity.statusCode, 201);
  assert.deepEqual(indemnity.body.refund.lines.map((l) => [l.bucket, l.amountTtc]), [['indemnity', 274]]);
  assert.equal(indemnity.body.collectedTtc, 0);
  assert.deepEqual(nonZero(netByAccount(db)), {}, 'every book account nets to 0');
});

test('reservation-refunds rule 48 reading — a caisse-interne refund beyond the cash collected comes off the book money', accounting, () => {
  // Solde paid by transfer, nothing in the caisse interne: the review-#925 case keeps working.
  const { db, deps, controller } = seed({ balancePaid: 1 });
  cancel(deps);
  assert.equal(registerOf(controller).collectedTtc, 914);
  const cash = refund(controller, [{ key: 'accommodation', amountTtc: 640 }], 'internal');
  assert.equal(cash.statusCode, 201);
  assert.equal(cash.body.collectedTtc, 274);
  const indemnity = refund(controller, [{ key: 'accommodation', amountTtc: 274 }], 'transfer');
  assert.equal(indemnity.statusCode, 201);
  assert.deepEqual(indemnity.body.refund.lines.map((l) => [l.bucket, l.amountTtc]), [['indemnity', 274]]);
  const net = netByAccount(db);
  assert.equal(net['75880000'] || 0, 0);
});

test('reservation-refunds rule 48 reading — the caisse-interne budget is shared: a second refund sees what the first took', accounting, () => {
  const { deps, controller } = seed({ balancePaid: 1, balanceCash: 1 });
  cancel(deps);
  assert.equal(refund(controller, [{ key: 'accommodation', amountTtc: 600 }], 'internal').statusCode, 201);
  const register = registerOf(controller);
  assert.equal(register.collectedTtc, 314);
  assert.equal(accommodationOf(register).cashTtc, 40);
  const tooMuch = refund(controller, [{ key: 'accommodation', amountTtc: 50 }], 'internal');
  assert.equal(tooMuch.statusCode, 409);
  assert.equal(tooMuch.body.code, 'REFUND_INDEMNITY_OFF_BOOKS');
  assert.equal(refund(controller, [{ key: 'accommodation', amountTtc: 40 }], 'internal').statusCode, 201);
});

test('reservation-refunds rule 48 reading (review of PR #929, F4) — cash no line can give back is never promised', () => {
  const { db, deps, controller } = seed({ balancePaid: 1 });
  // The end-of-stay complement, collected in the caisse interne, is no line of the register.
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 30, endOfStayComplementPaid = 1, endOfStayComplementPaidCash = 1, endOfStayComplementPaidDate = ? WHERE id = 10').run(TODAY);
  cancel(deps);
  const register = registerOf(controller);
  assert.ok(register.refundableLines.every((l) => !l.cashTtc), 'no line carries it');
  assert.equal(register.collectedTtc, 914, 'the caption names what the lines can give back');
  const tooMuch = refund(controller, [{ key: 'accommodation', amountTtc: 914 }, { amountTtc: 30, label: 'Complément' }], 'internal');
  assert.equal(tooMuch.statusCode, 409);
  assert.equal(tooMuch.body.code, 'REFUND_EXCEEDS_COLLECTED');
  assert.match(tooMuch.body.error, /914,00/);
});
