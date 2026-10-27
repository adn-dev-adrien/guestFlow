// specs/direct-installments.md rule 46 (audit 2026-10-27, finding 11) — cancelling a stay paid through an
// installment plan requalifies what the installments collected, exactly as a retained acompte
// (specs/payment-schedule-and-cancellation.md §3.6): an avoir reversing the stay revenue + VAT and the
// tourist tax inside it, and a VAT-free indemnity for the same sum. It used to book nothing — the plan
// zeroes the acompte, and the requalification only looked at a paid acompte.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { cancelReservation } = require('../utils/cancelReservation');
const reservationsModelFactory = require('../models/reservationsModel');
const refundsModelFactory = require('../models/refundsModel');
const compensationsModelFactory = require('../models/cancellationCompensationsModel');
const paymentLinksModelFactory = require('../models/paymentLinksModel');
const { buildModel: buildInstallmentsModel } = require('../models/installmentsModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const TODAY = '2026-08-19';

// 600 € + 12 € of tourist tax in 3 × 204 €, the first two collected (each carries 4 € of tax).
function seed({ paid = 2 } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec(`
    ALTER TABLE reservations ADD COLUMN installmentsPaidAmount REAL NOT NULL DEFAULT 0;
    ALTER TABLE reservations ADD COLUMN installmentsUnpaidAmount REAL NOT NULL DEFAULT 0;
    ALTER TABLE reservations ADD COLUMN installmentsTarget REAL NOT NULL DEFAULT 0;
    ALTER TABLE reservations ADD COLUMN installmentsLastPaidDate TEXT;
  `);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Le Lodge')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Marie', 'Dupont', 'marie@example.com')").run();
  db.prepare(`
    INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, checkInTime, checkOutTime, platform,
      finalPrice, touristTaxTotal, depositAmount, depositPaid, balanceAmount, balancePaid)
    VALUES (10, 'reservation', 1, 1, '2026-09-18', '2026-09-25', '15:00', '10:00', 'direct', 600, 12, 0, 0, 0, 0)
  `).run();
  const installmentsModel = buildInstallmentsModel(db);
  const plan = installmentsModel.replacePlan(10, [
    { number: 1, dueDate: '2026-05-10', amountCents: 20400 },
    { number: 2, dueDate: '2026-07-10', amountCents: 20400 },
    { number: 3, dueDate: '2026-08-10', amountCents: 20400 },
  ], 61200);
  plan.slice(0, paid).forEach((i) => installmentsModel.markPaid(i.id, { paidDate: i.dueDate, method: 'transfer' }));
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

test('the installments collected are retained: avoir (stay at 10 % + tax at 0 %) and a VAT-free indemnity', () => {
  const { db, deps } = seed();
  const out = cancel(deps);
  assert.equal(out.ok, true);
  assert.equal(out.retainedDepositAmount, 408, 'the two installments collected, not 0');
  assert.equal(out.writtenOffBalance, 204, 'the unpaid installment is what is abandoned');
  assert.equal(out.cancellationReason, 'unpaid_balance');

  const refund = db.prepare('SELECT * FROM reservation_refunds WHERE id = ?').get(out.refundId);
  assert.equal(refund.method, 'retained');
  assert.equal(refund.totalTtc, 408);
  assert.equal(refund.refundDate, TODAY);
  const lines = db.prepare('SELECT bucket, amountTtc, vatRate FROM reservation_refund_lines WHERE refundId = ? ORDER BY id').all(out.refundId);
  assert.deepEqual(lines.map((l) => [l.bucket, l.amountTtc, l.vatRate]), [['accommodation', 400, 10], ['touristTax', 8, 0]]);

  const compensation = db.prepare('SELECT * FROM cancellation_compensations WHERE id = ?').get(out.compensationId);
  assert.equal(compensation.receivedAmount, 408);
  assert.equal(compensation.origin, 'retained_deposit');
});

test('a plan nothing was collected on books nothing', () => {
  const { db, deps } = seed({ paid: 0 });
  const out = cancel(deps);
  assert.equal(out.retainedDepositAmount, 0);
  assert.equal(out.refundId, null);
  assert.equal(out.compensationId, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_refunds').get().n, 0);
});

test('tax paid at arrival: the installments carried none, so the avoir reverses no tourist tax', () => {
  const { db, deps } = seed();
  db.prepare('UPDATE reservations SET touristTaxInComplement = 1 WHERE id = 10').run();
  const out = cancel(deps);
  assert.equal(out.retainedDepositAmount, 408);
  const lines = db.prepare('SELECT bucket, amountTtc, vatRate FROM reservation_refund_lines WHERE refundId = ? ORDER BY id').all(out.refundId);
  assert.deepEqual(lines.map((l) => [l.bucket, l.amountTtc, l.vatRate]), [['accommodation', 408, 10]]);
});
