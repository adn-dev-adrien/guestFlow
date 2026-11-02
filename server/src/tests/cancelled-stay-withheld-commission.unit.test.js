// specs/payment-schedule-and-cancellation.md rule 55 and specs/reservation-refunds.md rule 48, readings of 2026-11-02
// (review of PR #926, residual A). A direct stay collected through a payment provider (Lodgify / Stripe) is booked
// gross, the provider's commission on 622600; what reached the bank is net of it (`comptaCollected`). Cancelled, it
// requalified only the gross acompte: the commissions withheld could neither be given back nor requalified, so once
// every collected euro went back they stayed as sales revenue with collected VAT on a cancelled stay. Now the
// cancellation requalifies them too (the avoir reverses 706 + VAT on them, the indemnity includes them) and the
// register never offers them from the indemnity: 706, 4457, 4671 and the client account end at 0, 7588 keeps the
// commissions and 622600 their cost.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { cancelReservation } = require('../utils/cancelReservation');
const { migrateInstallmentsSchema } = require('../utils/installmentsMigration');
const { localIsoDate } = require('../utils/localDate');
const { setDirectChannels } = require('../utils/platformNameFormat');
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

test.before(() => setDirectChannels(['Lodgify']));
test.after(() => setDirectChannels([]));

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

test('payment-schedule-and-cancellation rule 55 reading — the commissions withheld are requalified with the acompte kept', () => {
  const { deps } = seedWithContribs();
  const out = cancel(deps);
  assert.equal(out.retainedDepositAmount, 274, 'the acompte kept, as the history says');
  const avoir = deps.refundsModel.listByReservation(10).find((r) => r.method === 'retained');
  // The acompte was reversed whole, its 8,22 € inside; the solde's 19,20 € join it.
  assert.equal(avoir.totalTtc, 293.2);
  assert.equal(round2(avoir.lines.reduce((t, l) => t + l.amountTtc, 0)), 293.2);
  const commission = avoir.lines.filter((l) => l.lineKey === 'commission');
  assert.equal(round2(commission.reduce((t, l) => t + l.amountTtc, 0)), 27.42, 'both commissions named');
  assert.ok(commission.every((l) => l.vatRate === 10 && l.unitPrice === 0 && ['accommodation', 'options'].includes(l.bucket)));
  const compensation = deps.compensationsModel.getById(out.compensationId);
  assert.equal(compensation.receivedAmount, 293.2);
});

test('reservation-refunds rule 48 reading — the register never offers the commissions from the indemnity', () => {
  const { deps, controller } = seedWithContribs();
  cancel(deps);
  const register = registerOf(controller);
  assert.equal(register.collectedTtc, 886.58, 'what reached the bank');
  const offered = register.refundableLines.reduce((t, l) => t + Math.round(l.refundableTtc * 100), 0) / 100;
  const fromIndemnity = register.refundableLines.reduce((t, l) => t + Math.round((l.indemnityTtc || 0) * 100), 0) / 100;
  assert.equal(offered, 886.58);
  assert.equal(fromIndemnity, 265.78, 'the acompte that reached the bank, never the commission withheld on it');
});

test('reservation-refunds rule 48 reading — everything given back: 706, VAT and the client at 0, 7588 the commissions, 622600 their cost', accounting, () => {
  const { db, deps, controller } = seedWithContribs();
  cancel(deps);
  assert.equal(giveBackAll(controller).statusCode, 201);
  assert.equal(registerOf(controller).collectedTtc, 0);
  const net = netByAccount(db);
  assert.equal(sumOf(net, '706'), 0, JSON.stringify(net));
  assert.equal(sumOf(net, '4457'), 0, JSON.stringify(net));
  assert.equal(sumOf(net, '4671'), 0, JSON.stringify(net));
  assert.equal(sumOf(net, '411'), 0, JSON.stringify(net));
  assert.equal(net['75880000'], -27.42);
  assert.equal(net['622600'], 27.42);
});

test('reservation-refunds rule 48 reading — stay #22226 (no contribs): every account nets to the cent, 7588 −6,82, 622600 +6,82', accounting, () => {
  const { db, deps, controller } = seedLegacy();
  cancel(deps);
  assert.equal(giveBackAll(controller).statusCode, 201);
  const net = netByAccount(db);
  for (const account of Object.keys(net).filter((a) => /^(706|4457|4671|411)/.test(a))) assert.equal(net[account], 0, `${account} ${JSON.stringify(net)}`);
  assert.equal(net['75880000'], -6.82);
  assert.equal(net['622600'], 6.82);
});

test('payment-schedule-and-cancellation rule 55 reading — a solde paid with no acompte: its commission alone is requalified', accounting, () => {
  const { db, deps, controller } = seedWithContribs();
  db.prepare('UPDATE reservations SET depositPaid = 0, depositPaidDate = NULL WHERE id = 10').run();
  const out = cancel(deps);
  assert.equal(out.retainedDepositAmount, 0);
  const avoir = deps.refundsModel.listByReservation(10).find((r) => r.method === 'retained');
  assert.equal(avoir.totalTtc, 19.2);
  assert.equal(registerOf(controller).collectedTtc, 620.8);
  assert.equal(giveBackAll(controller).statusCode, 201);
  const net = netByAccount(db);
  assert.equal(sumOf(net, '706'), 0, JSON.stringify(net));
  assert.equal(sumOf(net, '4457'), 0, JSON.stringify(net));
  assert.equal(net['75880000'], -19.2);
});

test('payment-schedule-and-cancellation rule 55 reading — a stay with no commission requalifies exactly what it did', () => {
  const { db, deps } = seedWithContribs();
  db.prepare('UPDATE reservations SET acompteCommissionAmount = NULL, platformCommissionAmount = NULL WHERE id = 10').run();
  const out = cancel(deps);
  const avoir = deps.refundsModel.listByReservation(10).find((r) => r.method === 'retained');
  assert.equal(out.retainedDepositAmount, 274);
  assert.equal(avoir.totalTtc, 274);
  assert.ok(avoir.lines.every((l) => l.lineKey !== 'commission'));
});

test('reservation-refunds rule 48 reading — an acompte only: the avoir stays the acompte, the indemnity offers it net of its commission', accounting, () => {
  const { db, deps, controller } = seedWithContribs({ balancePaid: 0 });
  const out = cancel(deps);
  assert.equal(out.retainedDepositAmount, 274);
  assert.equal(deps.refundsModel.listByReservation(10).find((r) => r.method === 'retained').totalTtc, 274);
  assert.equal(deps.compensationsModel.getById(out.compensationId).receivedAmount, 274);
  assert.equal(registerOf(controller).collectedTtc, 265.78);
  assert.equal(giveBackAll(controller).statusCode, 201);
  const net = netByAccount(db);
  for (const account of Object.keys(net).filter((a) => /^(706|4457|4671|411)/.test(a))) assert.equal(net[account], 0, `${account} ${JSON.stringify(net)}`);
  assert.equal(net['75880000'], -8.22);
  assert.equal(net['622600'], 8.22);
});

test('payment-schedule-and-cancellation rule 55 reading — the ledger names an avoir of a commission alone « Commission retenue »', () => {
  const { buildLedger } = require('../utils/reservationLedger');
  const { db, deps } = seedWithContribs();
  db.prepare('UPDATE reservations SET depositPaid = 0, depositPaidDate = NULL WHERE id = 10').run();
  cancel(deps);
  const refunds = deps.refundsModel.listByReservation(10);
  const ledger = buildLedger({ row: deps.reservationsModel.getForCancellation(10), refunds, today: TODAY });
  const row = ledger.rows.find((r) => r.key === `refund-${refunds[0].id}`);
  assert.equal(row.label, 'Commission retenue');
  assert.equal(row.action, null);
});
