// specs/direct-installments.md rule 46, reading of 2026-11-01 (audit R13-M1) — cancelling a stay paid through
// an installment plan reverses each bucket the installments were booked on (their frozen `paidSplit`, rule 47),
// not the whole stay part on « Location gîte ». The avoir used to put options and resources on the
// accommodation line: 70600000 went negative, 70600010 kept revenue for a stay that never happened, and the
// refund register still offered the requalified options (specs/reservation-refunds.md rule 45).
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
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const { create: createAccountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { entryToStructured } = optionalPlugin(() => require('../plugins/accounting-export/accountingExport'));

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
const avoirLines = (db, refundId) => db.prepare('SELECT lineKey, bucket, amountTtc, vatRate FROM reservation_refund_lines WHERE refundId = ? ORDER BY id')
  .all(refundId).map((l) => [l.lineKey, l.bucket, l.amountTtc, l.vatRate]);

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

test('the avoir reverses each bucket the paid installments were booked on', () => {
  const { db, deps } = seed();
  const out = cancel(deps);
  assert.equal(out.retainedDepositAmount, 668);
  assert.deepEqual(avoirLines(db, out.refundId), [
    ['accommodation', 'accommodation', 440, 10],
    ['options', 'options', 220, 10],
    ['touristTax', 'touristTax', 8, 0],
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

test('the refund register no longer offers the options already requalified', () => {
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
});

test('an installment collected before rule 47 still reverses on the accommodation line', () => {
  const { db, deps } = seed({ frozen: false });
  const out = cancel(deps);
  assert.deepEqual(avoirLines(db, out.refundId), [
    ['accommodation', 'accommodation', 660, 10],
    ['touristTax', 'touristTax', 8, 0],
  ]);
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
  assert.equal(byKey['opt:1'].refundedTtc, 40);
  assert.equal(byKey['opt:2'].refundableTtc, 20);
  assert.equal(byKey['res:5'], undefined, 'a bucket amount beyond the lines clamps them to 0');
  assert.equal(byKey.accommodation.refundableTtc, 350, 'the accommodation keeps its own key');
});
