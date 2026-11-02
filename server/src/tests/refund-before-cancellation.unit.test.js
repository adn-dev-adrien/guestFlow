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
    database: deps.database,
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
  // A 32 € line paid at arrival, never collected: the lines used to offer it on top of the 914 € collected.
  const db = baseDb();
  db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (1, 'Dîner', 100, 'fixed'), (2, 'Linge', 32, 'fixed')").run();
  db.prepare(`
    INSERT INTO reservations
      (id, kind, propertyId, clientId, startDate, endDate, platform, finalPrice, totalPrice, depositAmount, depositPaid,
       depositPaidDate, balanceAmount, balancePaid, balancePaidDate, balanceDueDate, complementAmount, complementPaid)
    VALUES (10, 'reservation', 1, 1, ?, ?, 'direct', 946, 946, 274, 1, ?, 640, 1, ?, ?, 32, 0)
  `).run(inDays(60), inDays(67), TODAY, TODAY, inDays(30));
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice, inComplement) VALUES (10, 1, 1, 100, 0), (10, 2, 1, 32, 1)').run();
  const deps = depsOf(db);
  cancel(deps);
  const controller = controllerOf(deps);
  const register = registerOf(controller);
  assert.equal(register.collectedTtc, 914);
  assert.equal(sum(register.refundableLines.map((l) => l.refundableTtc)), 914);
  assert.equal(register.refundableLines.some((l) => l.key === 'opt:2'), false, 'the line never collected is not offered');
  const all = refund(controller, register.refundableLines.map((l) => ({ key: l.key, amountTtc: l.refundableTtc })));
  assert.equal(all.statusCode, 201, JSON.stringify(all.body));
});

// ── Review of PR #926 (2026-11-02) ──────────────────────────────────────────────────────────────────────────────

function setRates(db, rate) {
  if (!db.prepare('SELECT 1 FROM app_settings WHERE id = 1').get()) db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  db.prepare('UPDATE app_settings SET vatRate = ? WHERE id = 1').run(rate);
}

const controllerAt = (deps, rate) => createRefundsController({
  database: deps.database,
  refundsModel: deps.refundsModel, reservationsModel: deps.reservationsModel, vatRateOf: () => rate, storedOverpaymentTtc: () => 0,
});
const cancelAt = (deps, rate) => cancelReservation(deps, 10, { today: TODAY, vatRate: rate, reason: 'Solde jamais réglé' });

// 946 € direct stay: accommodation 714, a 200 € dinner, a 32 € linen line paid at arrival (never collected).
// Acompte 274 € = 200 accommodation + 74 dinner; paid solde 652 € = 514 accommodation + 126 dinner + 12 tax.
function seedWithContribs(rate = 10) {
  const db = baseDb();
  setRates(db, rate);
  db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (1, 'Dîner', 200, 'fixed'), (2, 'Linge', 32, 'fixed')").run();
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, platform, finalPrice, totalPrice,
      touristTaxTotal, depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balancePaidDate, balanceDueDate,
      complementAmount, complementPaid, accommodationAcompteContribTtc, touristTaxAcompteContribTtc,
      accommodationSoldeContribTtc, touristTaxSoldeContribTtc)
    VALUES (10, 'reservation', 1, 1, ?, ?, 'direct', 946, 946, 12, 274, 1, ?, 652, 1, ?, ?, 32, 0, 200, 0, 514, 12)`)
    .run(inDays(60), inDays(67), TODAY, TODAY, inDays(30));
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice, inComplement, acompteContribTtc, soldeContribTtc)
    VALUES (10, 1, 1, 200, 0, 74, 126), (10, 2, 1, 32, 1, 0, 0)`).run();
  return { db, deps: depsOf(db) };
}

// The shape of stay #22226, anonymised: a legacy direct stay (no contribs) of 282,44 € with 192 € of options, 32 € of
// them paid at arrival, 2,32 € of tax; acompte 126,38 € and solde 126,38 € paid.
function seedLegacyWithSolde() {
  const db = baseDb();
  db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (1, 'Dîner', 100, 'fixed'), (2, 'Panier', 28, 'fixed'), (3, 'Linge', 32, 'fixed'), (4, 'Petit-déjeuner', 32, 'fixed')").run();
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, platform, finalPrice, totalPrice,
      touristTaxTotal, depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balancePaidDate, balanceDueDate,
      complementAmount, complementPaid)
    VALUES (10, 'reservation', 1, 1, ?, ?, 'direct', 282.44, 282.44, 2.32, 126.38, 1, ?, 126.38, 1, ?, ?, 32, 0)`)
    .run(inDays(60), inDays(62), TODAY, TODAY, inDays(30));
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice, inComplement)
    VALUES (10, 1, 1, 100, 0), (10, 2, 1, 28, 0), (10, 3, 1, 32, 1), (10, 4, 1, 32, 0)`).run();
  return { db, deps: depsOf(db) };
}

// Give back what the register offers as sale money (the indemnity stays kept): the usual flow after a cancellation.
function giveBackSale(controller) {
  let total = 0;
  for (const line of registerOf(controller).refundableLines) {
    const amountTtc = round2(line.refundableTtc - (line.indemnityTtc || 0));
    if (amountTtc <= 0) continue;
    const out = refund(controller, [{ key: line.key, amountTtc }]);
    assert.equal(out.statusCode, 201, `${line.key} ${amountTtc}: ${JSON.stringify(out.body)}`);
    total = round2(total + amountTtc);
  }
  return total;
}

test('payment-schedule rule 55 — legacy stay, paid solde: a refund before the cancellation comes off the solde, never the acompte', () => {
  const baseline = seedLegacyWithSolde();
  assert.equal(cancel(baseline.deps).retainedDepositAmount, 126.38);
  const backWithout = giveBackSale(controllerOf(baseline.deps));
  assert.equal(backWithout, 126.38);

  const { deps } = seedLegacyWithSolde();
  const controller = controllerOf(deps);
  assert.equal(refund(controller, [{ key: 'accommodation', amountTtc: 50 }]).statusCode, 201);
  const out = cancel(deps);
  assert.equal(out.retainedDepositAmount, 126.38, 'the paid solde absorbs the 50 €: the acompte is kept whole');
  const card = deps.database.prepare('SELECT receivedAmount FROM cancellation_compensations WHERE reservationId = 10').get();
  assert.equal(card.receivedAmount, 126.38);
  assert.equal(round2(50 + giveBackSale(controller)), backWithout, 'following the register gives back what it would without the refund');
});

test('payment-schedule rule 55 — legacy acompte: the avoir reverses the buckets the export booked it on (stay #14)', accounting, () => {
  // Stay #14, anonymised: 807,20 € with an 80 € option, acompte 242,16 € and solde 565,04 € paid, and a stray
  // accommodation contrib (807,20 €) the export rejects, so both entries were booked on the stored-money split.
  const db = baseDb();
  db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (1, 'Panier', 80, 'fixed')").run();
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, platform, finalPrice, totalPrice,
      depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balancePaidDate, balanceDueDate, accommodationAcompteContribTtc)
    VALUES (10, 'reservation', 1, 1, ?, ?, 'direct', 807.2, 727.2, 242.16, 1, ?, 565.04, 1, ?, ?, 807.2)`)
    .run(inDays(60), inDays(65), TODAY, TODAY, inDays(30));
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice) VALUES (10, 1, 1, 80)').run();
  const deps = depsOf(db);
  cancel(deps);
  const controller = controllerOf(deps);
  assert.deepEqual(retainedOf(registerOf(controller)).lines.map((l) => [l.bucket, l.amountTtc]), [['accommodation', 218.16], ['options', 24]]);
  giveBackAll(controller);
  const net = netByAccount(db);
  assertSalesAccountsAtZero(net);
  assert.equal(net['75880000'] || 0, 0);
  assert.equal(net.CTEST || 0, 0);
});

test('payment-schedule rule 55 — the solde absorbs what IT collected on a bucket, not the bucket billed minus the acompte', () => {
  const { deps } = seedWithContribs();
  const controller = controllerOf(deps);
  assert.equal(refund(controller, [{ key: 'accommodation', amountTtc: 514 }, { key: 'opt:1', amountTtc: 156 }]).statusCode, 201);
  // The solde collected 652 € (the 32 € linen line was never collected, billed − acompte would say 684 €): of the
  // 670 € given back, 18 € come off the acompte. The dinner lacked 30 € on its solde share: they come off its acompte
  // share, and the 12 € of tax the solde collected, which covered part of them, are kept in their place.
  assert.equal(cancel(deps).retainedDepositAmount, 256);
  assert.deepEqual(retainedOf(registerOf(controller)).lines.map((l) => [l.bucket, l.amountTtc]), [['accommodation', 200], ['options', 44], ['touristTax', 12]]);
  const left = registerOf(controller).refundableLines;
  assert.equal(sum(left.map((l) => round2(l.refundableTtc - l.indemnityTtc))), 0, 'nothing of the sale is left');
  assert.equal(sum(left.map((l) => l.indemnityTtc)), 256);
});

test('reservation-refunds rule 49 — a line never collected is not offered: every 706 sub-account nets to 0', accounting, () => {
  const { db, deps } = seedWithContribs();
  cancel(deps);
  const controller = controllerOf(deps);
  const register = registerOf(controller);
  assert.deepEqual(register.refundableLines.map((l) => [l.key, l.refundableTtc]), [['accommodation', 714], ['opt:1', 200], ['touristTax', 12]]);
  const all = refund(controller, register.refundableLines.map((l) => ({ key: l.key, amountTtc: l.refundableTtc })));
  assert.equal(all.statusCode, 201, JSON.stringify(all.body));
  const net = netByAccount(db);
  assertSalesAccountsAtZero(net);
  assert.equal(net['75880000'] || 0, 0);
  assert.equal(net.CTEST || 0, 0);
});

test('payment-schedule rule 55 — a paid solde absorbed part of a bucket: VAT and revenue net to the cent (fuzz, 5,5 / 10 / 20 %)', accounting, () => {
  const drift = [];
  for (const rate of [5.5, 10, 20]) {
    for (const amount of [126.01, 127.13, 131.17, 140.03, 150.07, 163.33, 171.11, 180.19, 190.91, 199.99]) {
      const { db, deps } = seedWithContribs(rate);
      const controller = controllerAt(deps, rate);
      assert.equal(refund(controller, [{ key: 'opt:1', amountTtc: amount }]).statusCode, 201);
      cancelAt(deps, rate);
      for (const line of registerOf(controller).refundableLines) {
        const out = refund(controller, [{ key: line.key, amountTtc: line.refundableTtc }]);
        assert.equal(out.statusCode, 201, JSON.stringify(out.body));
      }
      const left = Object.entries(netByAccount(db)).filter(([, value]) => value !== 0);
      if (left.length) drift.push([rate, amount, left]);
    }
  }
  assert.deepEqual(drift, []);
});

test('payment-schedule rule 55 — what is kept is the acompte minus what earlier refunds took, never the sum of off-by-a-cent lines', () => {
  const { buildCancellationRequalification } = require('../utils/cancellationRequalification');
  const row = { id: 1, depositPaid: 1, depositAmount: 274, platform: 'direct' };
  for (const options of [73.99, 74.01]) {
    const out = buildCancellationRequalification({ reservation: row, depositBuckets: { accommodation: 200, options, resources: 0 }, cancellationDate: TODAY, vatRate: 10 });
    assert.equal(out.retainedTtc, 274, `contribs 200 + ${options}`);
    assert.equal(sum(out.refund.lines.map((l) => l.amountTtc)), 274, 'the last contrib bucket snaps to the acompte');
    assert.equal(out.compensation.receivedAmount, 274);
  }
  const plan = buildCancellationRequalification({
    reservation: { id: 1, platform: 'direct' },
    installmentsRetained: { amountTtc: 100, touristTaxTtc: 0, installments: [{ number: 1, count: 2, accommodation: 60, options: 39.99, resources: 0 }] },
    cancellationDate: TODAY,
    vatRate: 10,
  });
  assert.equal(plan.retainedTtc, 100, 'an installment split one cent short keeps the installment collected');
});

// ── Second review of PR #926 (2026-11-02) ───────────────────────────────────────────────────────────────────────

const { buildLedger } = require('../utils/reservationLedger');

const removeRefund = (controller, refundId) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.remove({ params: { id: '10', refundId: String(refundId) } }, res);
  return res;
};

// 914 € direct stay: accommodation 714 and a 200 € dinner; acompte 274 € = 200 accommodation + 74 dinner (contribs).
function seedDepositWithContribs() {
  const db = baseDb();
  db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (1, 'Dîner', 200, 'fixed')").run();
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, platform, finalPrice, totalPrice,
      touristTaxTotal, depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balanceDueDate,
      accommodationAcompteContribTtc, touristTaxAcompteContribTtc)
    VALUES (10, 'reservation', 1, 1, ?, ?, 'direct', 914, 914, 12, 274, 1, ?, 652, 0, ?, 200, 0)`)
    .run(inDays(60), inDays(67), TODAY, inDays(30));
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice, acompteContribTtc) VALUES (10, 1, 1, 200, 74)').run();
  return { db, deps: depsOf(db) };
}

test('payment-schedule rule 55 — a refund the cancellation deducted is never deleted: 409, nothing offered back, the books unchanged', accounting, () => {
  const { db, deps } = seedDepositWithContribs();
  const controller = controllerOf(deps);
  const before = refund(controller, [{ key: 'accommodation', amountTtc: 100 }]);
  assert.equal(before.statusCode, 201);
  assert.equal(cancel(deps).retainedDepositAmount, 174);
  const register = registerOf(controller);
  const books = netByAccount(db);

  const out = removeRefund(controller, before.body.refund.id);
  assert.equal(out.statusCode, 409);
  assert.equal(out.body.code, 'REFUND_NETTED_BY_CANCELLATION');
  assert.equal(out.body.error, 'Remboursement déduit de l’acompte conservé.');
  assert.deepEqual(registerOf(controller), register, 'the register is unchanged');
  assert.deepEqual(netByAccount(db), books, 'the books are unchanged');

  // The fiche offers no « Supprimer » on it.
  const reservation = deps.reservationsModel.getByIdWithDetails(10);
  const ledger = buildLedger({ row: reservation, refunds: register.refunds, today: TODAY });
  assert.equal(ledger.rows.find((r) => r.key === `refund-${before.body.refund.id}`).action, null);

  // A refund made after the cancellation is not concerned (rule 55 nets only the earlier ones).
  const after = refund(controller, [{ key: 'accommodation', amountTtc: 10 }]);
  assert.equal(after.statusCode, 201, JSON.stringify(after.body));
  assert.equal(removeRefund(controller, after.body.refund.id).statusCode, 200);
  // Nor is the caisse interne, which the cancellation never deducted.
  const { deps: cashDeps } = seedDepositWithContribs();
  const cashController = controllerOf(cashDeps);
  const internal = refund(cashController, [{ key: 'accommodation', amountTtc: 100 }], 'internal');
  cancel(cashDeps);
  assert.equal(removeRefund(cashController, internal.body.refund.id).statusCode, 200);
});

test('payment-schedule rule 55 — contribs a cent or two off snap onto the largest bucket: never more kept than collected', () => {
  const { buildCancellationRequalification } = require('../utils/cancellationRequalification');
  const row = { id: 1, depositPaid: 1, depositAmount: 274, platform: 'direct' };
  const out = buildCancellationRequalification({ reservation: row, depositBuckets: { accommodation: 274.01, options: 0.01, resources: 0 }, cancellationDate: TODAY, vatRate: 10 });
  assert.equal(out.retainedTtc, 274);
  assert.equal(out.compensation.receivedAmount, 274);
  assert.deepEqual(out.refund.lines.map((l) => [l.bucket, l.amountTtc]), [['accommodation', 273.99], ['options', 0.01]]);
});

// A legacy direct stay (no contribs): accommodation A, a dinner O, tax T; acompte `dep` paid, solde paid or not.
function seedLegacy({ A, O, R = 0, T, dep, balancePaid = false, rate = 10 }) {
  const db = baseDb();
  setRates(db, rate);
  const price = round2(A + O + R);
  db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (1, 'Dîner', ?, 'fixed')").run(O || 1);
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, platform, finalPrice, totalPrice,
      touristTaxTotal, depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balancePaidDate, balanceDueDate)
    VALUES (10, 'reservation', 1, 1, ?, ?, 'direct', ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
    .run(inDays(60), inDays(67), price, price, T, dep, TODAY, round2(price + T - dep), balancePaid ? 1 : 0, balancePaid ? TODAY : null, inDays(30));
  if (O) db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice) VALUES (10, 1, 1, ?)').run(O);
  if (R) {
    db.prepare("INSERT INTO resources (id, name) VALUES (1, 'Bain')").run();
    db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, totalPrice) VALUES (10, 1, ?)').run(R);
  }
  return { db, deps: depsOf(db) };
}

const salesDrift = (net) => Object.entries(net).filter(([account, value]) => /^(706|445|467)/.test(account) && value !== 0);

test('payment-schedule rule 55 — a legacy acompte is reversed on the HT and VAT its entry booked, to the cent (5,5 / 10 / 20 %)', accounting, () => {
  let seed = 3;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const amount = (a, b) => round2(a + Math.floor(rnd() * (b - a) * 100) / 100);
  const drift = [];
  for (const rate of [5.5, 10, 20]) {
    for (let k = 0; k < 60; k++) {
      const A = amount(200, 1500);
      const O = rnd() < 0.8 ? amount(5, 400) : 0;
      const R = rnd() < 0.4 ? amount(5, 200) : 0;
      const T = amount(0, 30);
      const dep = round2(round2(A + O + R) * [0.3, 0.33, 0.5, 0.25][Math.floor(rnd() * 4)]);
      const { db, deps } = seedLegacy({ A, O, R, T, dep, rate });
      cancelAt(deps, rate);
      const left = salesDrift(netByAccount(db));
      if (left.length) drift.push([rate, A, O, R, dep, left]);
    }
  }
  assert.deepEqual(drift, []);
});

test('payment-schedule rule 55 — a legacy acompte netted of earlier refunds mirrors its entry: 706 and 4457 at 0 (case 16)', accounting, () => {
  const { db, deps } = seedLegacy({ A: 1400.73, O: 209.67, T: 35.08, dep: 805.2 });
  const controller = controllerOf(deps);
  assert.equal(refund(controller, [{ key: 'accommodation', amountTtc: 246.75 }, { key: 'opt:1', amountTtc: 31.68 }]).statusCode, 201);
  assert.equal(refund(controller, [{ key: 'accommodation', amountTtc: 216.57 }, { key: 'opt:1', amountTtc: 31.06 }]).statusCode, 201);
  assert.equal(cancel(deps).retainedDepositAmount, 279.14);
  const net = netByAccount(db);
  assert.deepEqual(salesDrift(net), []);
  assert.equal(net['75880000'], -279.14);
});

test('reservation-refunds rule 49 — a legacy stay with a paid solde: giving everything back leaves nothing collected', accounting, () => {
  // The solde entry booked 6,04 € of tax and the dinner 44,34 € over both entries, against 6,05 € and 44,33 € billed:
  // the lines used to leave one cent of the 364,15 € collected that no line offered.
  const { deps } = seedLegacy({ A: 313.77, O: 44.33, T: 6.05, dep: 179.05, balancePaid: true });
  cancel(deps);
  const controller = controllerOf(deps);
  const register = registerOf(controller);
  assert.equal(register.collectedTtc, 364.15);
  assert.equal(sum(register.refundableLines.map((l) => l.refundableTtc)), 364.15);
  const all = refund(controller, register.refundableLines.map((l) => ({ key: l.key, amountTtc: l.refundableTtc })));
  assert.equal(all.statusCode, 201, JSON.stringify(all.body));
  assert.equal(registerOf(controller).collectedTtc, 0);
});

test('reservation-refunds rule 49 — giving back one line leaves what the others offer unchanged (stay #22226)', () => {
  const { deps } = seedLegacyWithSolde();
  deps.database.prepare('UPDATE reservations SET complementPaid = 1, complementPaidDate = ? WHERE id = 10').run(TODAY);
  cancel(deps);
  const controller = controllerOf(deps);
  const first = registerOf(controller).refundableLines;
  const offered = new Map(first.map((l) => [l.key, [l.refundableTtc, l.indemnityTtc]]));
  for (const line of first) {
    const sale = round2(line.refundableTtc - line.indemnityTtc);
    if (sale <= 0) continue;
    const out = refund(controller, [{ key: line.key, amountTtc: sale }]);
    assert.equal(out.statusCode, 201, JSON.stringify(out.body));
    assert.deepEqual(out.body.refund.lines.map((l) => l.bucket), [line.bucket], 'the sale part is sale money, never the indemnity');
    offered.set(line.key, [line.indemnityTtc, line.indemnityTtc]);
    const now = registerOf(controller).refundableLines;
    assert.deepEqual(new Map(now.map((l) => [l.key, [l.refundableTtc, l.indemnityTtc]])),
      new Map([...offered].filter(([, [left]]) => left > 0)), `after ${line.key}`);
  }
  const indemnity = registerOf(controller).refundableLines;
  assert.equal(sum(indemnity.map((l) => l.refundableTtc)), 126.38, 'the indemnity is all that is left');
  assert.equal(sum(indemnity.map((l) => l.indemnityTtc)), 126.38);
});
