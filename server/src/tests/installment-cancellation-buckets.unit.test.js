// specs/direct-installments.md rule 46, reading of 2026-11-01 (audit R13-M1) — cancelling a stay paid through
// an installment plan reverses each bucket the installments were booked on (their frozen `paidSplit`, rule 47),
// not the whole stay part on « Location gîte ». The avoir used to put options and resources on the
// accommodation line: 70600000 went negative, 70600010 kept revenue for a stay that never happened, and the
// refund register still offered the requalified options (specs/reservation-refunds.md rule 45).
// Reading of 2026-11-01 after review: one avoir line per paid installment and bucket, split HT / VAT line by
// line like each encaissement, so every account nets to the cent (specs/reservation-refunds.md rule 47); the
// register tells requalified money apart and spreads a bucket by largest remainder (specs/reservation-refunds.md rule 46).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { cancelReservation } = require('../utils/cancelReservation');
const { recordInstallmentPayment } = require('../utils/installmentPayment');
const { migrateInstallmentsSchema } = require('../utils/installmentsMigration');
const { buildRefundableLines } = require('../utils/refunds');
const { localIsoDate } = require('../utils/localDate');
const reservationsModelFactory = require('../models/reservationsModel');
const refundsModelFactory = require('../models/refundsModel');
const compensationsModelFactory = require('../models/cancellationCompensationsModel');
const paymentLinksModelFactory = require('../models/paymentLinksModel');
const { buildModel: buildInstallmentsModel } = require('../models/installmentsModel');
const { computeInstallmentPaidSplit } = require('../utils/installmentPaidSplit');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const { create: createAccountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { entryToStructured } = optionalPlugin(() => require('../plugins/accounting-export/accountingExport'));
const { __test: accountingInternals } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localIsoDate(d); };
const TODAY = inDays(0);

// 990 € = 660 € of accommodation + 330 € of options (a 220 € dinner and a 110 € basket), plus 12 € of tax,
// in 3 × 334 €: each installment carries 4 € of tax, 220 € of accommodation and 110 € of options.
function seed({ paid = 2, frozen = true } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  migrateInstallmentsSchema(db);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte Test')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Test')").run();
  db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (1, 'Dîner', 110, 'fixed'), (2, 'Panier', 110, 'fixed')").run();
  db.prepare(`
    INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, checkInTime, checkOutTime, platform,
      finalPrice, totalPrice, touristTaxTotal, depositAmount, depositPaid, balanceAmount, balancePaid)
    VALUES (10, 'reservation', 1, 1, ?, ?, '15:00', '10:00', 'direct', 990, 990, 12, 0, 0, 0, 0)
  `).run(inDays(60), inDays(67));
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice) VALUES
    (10, 1, 2, 220), (10, 2, 1, 110)`).run();
  const installmentsModel = buildInstallmentsModel(db);
  const plan = installmentsModel.replacePlan(10, [
    { number: 1, dueDate: inDays(1), amountCents: 33400 },
    { number: 2, dueDate: inDays(20), amountCents: 33400 },
    { number: 3, dueDate: inDays(40), amountCents: 33400 },
  ], 100200);
  plan.slice(0, paid).forEach((i) => {
    recordInstallmentPayment({ db }, { installmentId: i.id, paidDate: TODAY, method: 'transfer' });
    // An installment collected before rule 47 carries no frozen split.
    if (!frozen) db.prepare('UPDATE reservation_installments SET paidSplit = NULL WHERE id = ?').run(i.id);
  });
  const deps = {
    database: db,
    reservationsModel: reservationsModelFactory.create(db),
    refundsModel: refundsModelFactory.createModel(db),
    compensationsModel: compensationsModelFactory.buildModel(db),
    paymentLinksModel: paymentLinksModelFactory.buildModel(db),
    installmentsModel,
  };
  return { db, deps };
}

const cancel = (deps) => cancelReservation(deps, 10, { today: TODAY, vatRate: 10, reason: 'Échéance jamais réglée' });
const avoirLines = (db, refundId) => db.prepare('SELECT lineKey, label, amountTtc, vatRate FROM reservation_refund_lines WHERE refundId = ? ORDER BY id')
  .all(refundId).map((l) => [l.lineKey, l.label, l.amountTtc, l.vatRate]);

// Σ debit − credit per account over the month's installments, avoir and indemnity.
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
      net[line.compte] = Math.round(((net[line.compte] || 0) + Number(line.debit || 0) - Number(line.credit || 0)) * 100) / 100;
    }
  }
  return { entries, net };
}

test('the avoir reverses each paid installment bucket by bucket, one line each', () => {
  const { db, deps } = seed();
  const out = cancel(deps);
  assert.equal(out.retainedDepositAmount, 668);
  assert.deepEqual(avoirLines(db, out.refundId), [
    ['accommodation', 'Hébergement — échéance 1/3', 220, 10],
    ['options', 'Options — échéance 1/3', 110, 10],
    ['accommodation', 'Hébergement — échéance 2/3', 220, 10],
    ['options', 'Options — échéance 2/3', 110, 10],
    ['touristTax', 'Taxe de séjour', 8, 0],
  ]);
});

test('the month nets to zero on every revenue, VAT and tax account; the indemnity alone stays', { skip: skipWithout(['accounting-export']) }, () => {
  const { db, deps } = seed();
  const before = netByAccount(db).net;
  assert.ok(before['70600010'] < 0, 'the installments credited the options account');
  cancel(deps);
  const { entries, net } = netByAccount(db);
  assert.deepEqual(entries.map((e) => e.kind).sort(), ['compensation', 'installment', 'installment', 'refund']);
  for (const account of Object.keys(net).filter((a) => /^(706|445|467)/.test(a))) {
    assert.equal(net[account], 0, `${account} nets to zero`);
  }
  assert.equal(net['75880000'], -668, 'the indemnity is the only revenue left');
});

test('the refund register no longer offers the options already requalified, and says they were requalified', () => {
  const { db, deps } = seed();
  const out = cancel(deps);
  const reservation = deps.reservationsModel.getByIdWithDetails(10);
  const lines = buildRefundableLines({
    finalPrice: reservation.finalPrice,
    touristTaxTotal: reservation.touristTaxTotal,
    vatRate: 10,
    options: reservation.options,
    resources: reservation.resources,
    refunds: deps.refundsModel.listByReservation(10),
    nights: 7,
  });
  const byKey = Object.fromEntries(lines.map((l) => [l.key, l.refundableTtc]));
  assert.ok(out.refundId);
  assert.equal(byKey.accommodation, 220, 'what the unpaid installment would have collected');
  assert.equal(Math.round((byKey['opt:1'] + byKey['opt:2']) * 100) / 100, 110, '330 € of options, 220 € requalified');
  assert.equal(byKey['opt:1'], 73.33);
  assert.equal(byKey['opt:2'], 36.67);
  const dinner = lines.find((l) => l.key === 'opt:1');
  assert.equal(dinner.requalifiedTtc, 146.67, 'refunds rule 46: requalified, never given back');
  assert.equal(dinner.refundedTtc, 0);
  assert.equal(lines.find((l) => l.key === 'accommodation').requalifiedTtc, 440);
});

test('an installment collected before rule 47 is reversed on the split the export spread it with', () => {
  const { db, deps } = seed({ frozen: false });
  const [first, second] = deps.installmentsModel.listFor(10);
  const spread = [first, second].map((i) => computeInstallmentPaidSplit(db, i.id));
  assert.deepEqual(spread[0], { taxCents: 400, accommodationCents: 22000, optionsCents: 11000, resourcesCents: 0 });
  const out = cancel(deps);
  assert.deepEqual(avoirLines(db, out.refundId), [
    ['accommodation', 'Hébergement — échéance 1/3', 220, 10],
    ['options', 'Options — échéance 1/3', 110, 10],
    ['accommodation', 'Hébergement — échéance 2/3', 220, 10],
    ['options', 'Options — échéance 2/3', 110, 10],
    ['touristTax', 'Taxe de séjour', 8, 0],
  ]);
});

// Stay #22326, anonymised: 3 053,60 € with 1 054 € of options and 36 € of tax, in 1 030 + 1 030 + 1 029,60 €.
// Each paid installment books 666,62 € of accommodation, 351,38 € of options and 12 € of tax; 351,38 € splits
// into 319,44 € HT + 31,94 € of VAT, and 702,76 € into 638,87 € + 63,89 €: one avoir line per installment is
// what keeps 70600010 and 44571100 at the cent.
function seedRealStay() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  migrateInstallmentsSchema(db);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte Test')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Test')").run();
  db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (1, 'Dîner', 1054, 'fixed')").run();
  db.prepare(`
    INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, checkInTime, checkOutTime, platform,
      finalPrice, totalPrice, touristTaxTotal, depositAmount, depositPaid, balanceAmount, balancePaid)
    VALUES (10, 'reservation', 1, 1, ?, ?, '15:00', '10:00', 'direct', 3053.6, 3053.6, 36, 0, 0, 0, 0)
  `).run(inDays(60), inDays(67));
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice) VALUES (10, 1, 1, 1054)').run();
  const installmentsModel = buildInstallmentsModel(db);
  const plan = installmentsModel.replacePlan(10, [
    { number: 1, dueDate: inDays(1), amountCents: 103000 },
    { number: 2, dueDate: inDays(20), amountCents: 103000 },
    { number: 3, dueDate: inDays(40), amountCents: 102960 },
  ], 308960);
  plan.slice(0, 2).forEach((i) => recordInstallmentPayment({ db }, { installmentId: i.id, paidDate: TODAY, method: 'transfer' }));
  const deps = {
    database: db,
    reservationsModel: reservationsModelFactory.create(db),
    refundsModel: refundsModelFactory.createModel(db),
    compensationsModel: compensationsModelFactory.buildModel(db),
    paymentLinksModel: paymentLinksModelFactory.buildModel(db),
    installmentsModel,
  };
  return { db, deps, plan };
}

test('stay #22326: two paid installments with 351,38 € of options each net to 0 on 70600010 and 44571100', { skip: skipWithout(['accounting-export']) }, () => {
  const { db, deps, plan } = seedRealStay();
  assert.deepEqual(deps.installmentsModel.paidSplitOf(plan[0].id), { taxCents: 1200, accommodationCents: 66662, optionsCents: 35138, resourcesCents: 0 });
  const out = cancel(deps);
  assert.equal(out.retainedDepositAmount, 2060);
  assert.deepEqual(avoirLines(db, out.refundId), [
    ['accommodation', 'Hébergement — échéance 1/3', 666.62, 10],
    ['options', 'Options — échéance 1/3', 351.38, 10],
    ['accommodation', 'Hébergement — échéance 2/3', 666.62, 10],
    ['options', 'Options — échéance 2/3', 351.38, 10],
    ['touristTax', 'Taxe de séjour', 24, 0],
  ]);
  const { net } = netByAccount(db);
  assert.equal(net['70600010'], 0);
  assert.equal(net['44571100'], 0);
  assert.equal(net['70600000'], 0);
  assert.equal(net['46710000'], 0);
  for (const account of Object.keys(net).filter((a) => /^(706|445|467)/.test(a))) {
    assert.equal(net[account], 0, `${account} nets to zero`);
  }
  assert.equal(net['75880000'], -2060, 'the indemnity is the only revenue left');
});

test('stay #22326 paid before rule 47: the export spread and the avoir agree, every account at 0', { skip: skipWithout(['accounting-export']) }, () => {
  const { db, deps, plan } = seedRealStay();
  plan.forEach((i) => db.prepare('UPDATE reservation_installments SET paidSplit = NULL WHERE id = ?').run(i.id));
  const out = cancel(deps);
  assert.deepEqual(avoirLines(db, out.refundId).map(([key, , amount]) => [key, amount]), [
    ['accommodation', 666.62], ['options', 351.38], ['accommodation', 666.62], ['options', 351.38], ['touristTax', 24],
  ]);
  const { net } = netByAccount(db);
  for (const account of Object.keys(net).filter((a) => /^(706|445|467)/.test(a))) {
    assert.equal(net[account], 0, `${account} nets to zero`);
  }
});

test('a retained avoir with one line per bucket books byte for byte what the per-bucket split booked', { skip: skipWithout(['accounting-export']) }, () => {
  const { buildRefundEntry } = accountingInternals;
  // An acompte avoir (payment-schedule spec §3.6): one line per bucket, odd cents on purpose.
  const lines = [
    { lineKey: 'accommodation', bucket: 'accommodation', amountTtc: 351.38, vatRate: 10 },
    { lineKey: 'options', bucket: 'options', amountTtc: 123.47, vatRate: 10 },
    { lineKey: 'resources', bucket: 'resources', amountTtc: 0.07, vatRate: 10 },
    { lineKey: 'touristTax', bucket: 'touristTax', amountTtc: 12.4, vatRate: 0 },
  ];
  const base = { id: 1, reservationId: 10, refundDate: TODAY, totalTtc: 487.32, lines };
  const retained = buildRefundEntry({ ...base, method: 'retained' });
  const perBucket = buildRefundEntry({ ...base, method: 'transfer' });
  assert.equal(JSON.stringify(retained.buckets), JSON.stringify(perBucket.buckets));
  assert.equal(retained.taxTtc, perBucket.taxTtc);
  // Two lines on one bucket: a real refund still splits the sum, a retained avoir each line.
  const twice = [{ bucket: 'options', amountTtc: 351.38, vatRate: 10 }, { bucket: 'options', amountTtc: 351.38, vatRate: 10 }];
  const two = { ...base, totalTtc: 702.76, lines: twice };
  assert.deepEqual(buildRefundEntry({ ...two, method: 'transfer' }).buckets, [{ name: 'options', ht: 638.87, vat: 63.89, ratePercent: 10 }]);
  assert.deepEqual(buildRefundEntry({ ...two, method: 'retained' }).buckets, [{ name: 'options', ht: 638.88, vat: 63.88, ratePercent: 10 }]);
});

test('a bucket-keyed avoir line consumes what each line still had to give back, never more', () => {
  const base = {
    finalPrice: 500, touristTaxTotal: 0, vatRate: 10, nights: 2,
    options: [{ optionId: 1, title: 'Dîner', totalPrice: 60 }, { optionId: 2, title: 'Panier', totalPrice: 40 }],
    resources: [{ resourceId: 5, name: 'Vélos', totalPrice: 50 }],
  };
  const lines = buildRefundableLines({
    ...base,
    refunds: [
      { method: 'transfer', totalTtc: 20, lines: [{ lineKey: 'opt:1', amountTtc: 20 }] },
      { method: 'retained', totalTtc: 140, lines: [{ lineKey: 'options', amountTtc: 40 }, { lineKey: 'resources', amountTtc: 100 }] },
    ],
  });
  const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));
  // 40 + 40 left on the options, 40 of them requalified: half of each.
  assert.equal(byKey['opt:1'].refundableTtc, 20);
  assert.equal(byKey['opt:1'].refundedTtc, 20, 'the transfer');
  assert.equal(byKey['opt:1'].requalifiedTtc, 20, 'the bucket avoir');
  assert.equal(byKey['opt:2'].refundableTtc, 20);
  assert.equal(byKey['res:5'], undefined, 'a bucket amount beyond the lines clamps them to 0');
  assert.equal(byKey.accommodation.refundableTtc, 350, 'the accommodation keeps its own key');
});

test('a bucket avoir is spread by largest remainder: every cent lands on a line that still had it', () => {
  const options = [1, 2, 3, 4, 5].map((id) => ({ optionId: id, title: `Option ${id}`, totalPrice: id === 5 ? 0.01 : 0.03 }));
  const lines = buildRefundableLines({
    finalPrice: 100.13, touristTaxTotal: 0, vatRate: 10, nights: 1, options, resources: [],
    refunds: [{ method: 'retained', totalTtc: 0.1, lines: [{ lineKey: 'options', amountTtc: 0.1 }] }],
  });
  const left = lines.filter((l) => l.bucket === 'options');
  // 0,13 € offered, 0,10 € requalified: 0,03 € stay, never 0,04 €.
  assert.equal(Math.round(left.reduce((sum, l) => sum + l.refundableTtc, 0) * 100), 3);
  assert.deepEqual(left.map((l) => [l.key, l.refundableTtc]), [['opt:2', 0.01], ['opt:3', 0.01], ['opt:4', 0.01]]);
});
