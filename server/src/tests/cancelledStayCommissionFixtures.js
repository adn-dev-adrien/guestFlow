// Shared fixtures of the cancelled-stay commission suites (specs/payment-schedule-and-cancellation.md rule 55 and
// specs/reservation-refunds.md rule 48, readings of 2026-11-02): a direct stay collected through a payment provider,
// cancelled, its register and the net balance of every account the export books.
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

// A 914 € stay booked through Lodgify (a direct channel): 714 € of accommodation and a 200 € dinner. Acompte 274 €
// (200 + 74) and solde 640 € (514 + 126), both paid, the provider withholding 8,22 € and 19,20 €.
function seedWithContribs({ balancePaid = 1 } = {}) {
  const db = baseDb();
  db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (1, 'Dîner', 200, 'fixed')").run();
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, platform, finalPrice, totalPrice,
      touristTaxTotal, depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balancePaidDate, balanceDueDate,
      acompteCommissionAmount, platformCommissionAmount, accommodationAcompteContribTtc, touristTaxAcompteContribTtc,
      accommodationSoldeContribTtc, touristTaxSoldeContribTtc)
    VALUES (10, 'reservation', 1, 1, ?, ?, 'Lodgify', 914, 914, 0, 274, 1, ?, 640, ?, ?, ?, 8.22, 19.2, 200, 0, 514, 0)`)
    .run(inDays(60), inDays(67), TODAY, balancePaid, balancePaid ? TODAY : null, inDays(30));
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice, acompteContribTtc, soldeContribTtc) VALUES (10, 1, 1, 200, 74, 126)').run();
  return { db, ...harnessOf(db) };
}

// Stay #22226, anonymised: an older Lodgify stay with no contribs — 282,44 € of which 192 € of options (one paid at
// arrival), 2,32 € of tax; acompte and solde of 126,38 € each, 3,41 € withheld on each.
function seedLegacy() {
  const db = baseDb();
  [[16, 100], [8, 28], [9, 32], [6, 32]].forEach(([id, price]) => db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (?, 'Option', ?, 'fixed')").run(id, price));
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, platform, finalPrice, totalPrice,
      touristTaxTotal, depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balancePaidDate, balanceDueDate,
      acompteCommissionAmount, platformCommissionAmount)
    VALUES (10, 'reservation', 1, 1, ?, ?, 'Lodgify', 282.44, 282.44, 2.32, 126.38, 1, ?, 126.38, 1, ?, ?, 3.41, 3.41)`)
    .run(inDays(60), inDays(63), TODAY, TODAY, inDays(30));
  [[16, 100, 0], [8, 28, 0], [9, 32, 1], [6, 32, 0]].forEach(([id, price, atArrival]) => db.prepare(
    'INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice, inComplement) VALUES (10, ?, 1, ?, ?)',
  ).run(id, price, atArrival));
  return { db, ...harnessOf(db) };
}

function baseDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  migrateInstallmentsSchema(db);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte Test')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Test')").run();
  return db;
}

function harnessOf(db) {
  const deps = {
    database: db,
    reservationsModel: reservationsModelFactory.create(db),
    refundsModel: refundsModelFactory.createModel(db),
    compensationsModel: compensationsModelFactory.buildModel(db),
    paymentLinksModel: paymentLinksModelFactory.buildModel(db),
  };
  const controller = createRefundsController({
    refundsModel: deps.refundsModel, reservationsModel: deps.reservationsModel, database: db, vatRateOf: () => 10, storedOverpaymentTtc: () => 0,
  });
  return { deps, controller };
}

function call(handler, body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  handler({ params: { id: '10' }, body }, res);
  return res;
}
const cancel = (deps) => cancelReservation(deps, 10, { today: TODAY, vatRate: 10 });
const registerOf = (controller) => call(controller.list).body;
// Every line the register offers, in one refund by transfer.
const giveBackAll = (controller) => call(controller.create, {
  refundDate: TODAY, method: 'transfer', lines: registerOf(controller).refundableLines.map((l) => ({ key: l.key, amountTtc: l.refundableTtc })),
});

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
  return Object.fromEntries(Object.entries(net).filter(([, value]) => Math.abs(value) >= 0.005));
}
const sumOf = (net, prefix) => round2(Object.entries(net).filter(([account]) => account.startsWith(prefix)).reduce((t, [, v]) => t + v, 0));


module.exports = {
  TODAY, round2, accounting, seedWithContribs, seedLegacy, call, cancel, registerOf, giveBackAll, netByAccount, sumOf,
};
