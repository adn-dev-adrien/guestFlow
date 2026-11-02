// specs/reservation-refunds.md rules 6 and 48, specs/payment-schedule-and-cancellation.md rule 55 and
// specs/calendar-property-parity.md rule 25, readings of 2026-11-02 (audit R15-C1 and its aside). A refund recorded on
// a cancelled stay could never be deleted from the fiche: the ledger gave every refund row of a cancelled stay no
// action. And the cancellation's own `retained` avoir could be deleted through the API, leaving the indemnity booked
// while the 706 reversal was gone. Now: a refund made AFTER the cancellation is deleted like any other; the avoir and
// every refund made before the cancellation (the avoir was netted of it) are refused, and the ledger says the same.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { cancelReservation } = require('../utils/cancelReservation');
const { migrateInstallmentsSchema } = require('../utils/installmentsMigration');
const { localIsoDate } = require('../utils/localDate');
const { buildLedger } = require('../utils/reservationLedger');
const reservationsModelFactory = require('../models/reservationsModel');
const refundsModelFactory = require('../models/refundsModel');
const compensationsModelFactory = require('../models/cancellationCompensationsModel');
const paymentLinksModelFactory = require('../models/paymentLinksModel');
const { createController: createRefundsController } = require('../controllers/refundsController');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localIsoDate(d); };
const TODAY = inDays(0);

// A direct stay of 914 €: acompte 274 € paid by transfer, solde 640 € paid or not.
function seed({ balancePaid = 0 } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  migrateInstallmentsSchema(db);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte Test')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Test')").run();
  db.prepare(`
    INSERT INTO reservations
      (id, kind, propertyId, clientId, startDate, endDate, platform,
       finalPrice, totalPrice, depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balancePaidDate, balanceDueDate)
    VALUES (10, 'reservation', 1, 1, ?, ?, 'direct', 914, 914, 274, 1, ?, 640, ?, ?, ?)
  `).run(inDays(60), inDays(67), TODAY, balancePaid, balancePaid ? TODAY : null, inDays(30));
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

function call(handler, req) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  handler(req, res);
  return res;
}
const cancel = (deps) => cancelReservation(deps, 10, { today: TODAY, vatRate: 10 });
const refund = (controller, lines, method = 'transfer') => call(controller.create, { params: { id: '10' }, body: { refundDate: TODAY, method, lines } });
const remove = (controller, refundId) => call(controller.remove, { params: { id: '10', refundId: String(refundId) } });
const registerOf = (controller) => call(controller.list, { params: { id: '10' } }).body;
const avoirOf = (deps) => deps.refundsModel.listByReservation(10).find((r) => r.method === 'retained');

test('reservation-refunds rule 6 reading — the retained avoir of a cancelled stay is never deleted: 409, the avoir and the indemnity stay', () => {
  const { deps, controller } = seed();
  cancel(deps);
  const avoir = avoirOf(deps);
  const out = remove(controller, avoir.id);
  assert.equal(out.statusCode, 409);
  assert.equal(out.body.code, 'REFUND_RETAINED_AVOIR');
  assert.match(out.body.error, /conservé/);
  assert.ok(avoirOf(deps), 'the avoir is still there');
  assert.equal(registerOf(controller).collectedTtc, 274);
});

test('reservation-refunds rule 48 reading — a refund made after the cancellation is deleted, and its money is offered again', () => {
  const { deps, controller } = seed();
  cancel(deps);
  const made = refund(controller, [{ key: 'accommodation', amountTtc: 50 }]);
  assert.equal(made.statusCode, 201);
  assert.equal(registerOf(controller).collectedTtc, 224);
  const out = remove(controller, made.body.refund.id);
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.collectedTtc, 274);
  assert.equal(deps.refundsModel.listByReservation(10).length, 1, 'only the avoir is left');
});

test('reservation-refunds rule 48 reading — a caisse-interne refund made after the cancellation is deleted too', () => {
  const { deps, controller } = seed({ balancePaid: 1 });
  cancel(deps);
  const made = refund(controller, [{ key: 'accommodation', amountTtc: 40 }], 'internal');
  assert.equal(made.statusCode, 201);
  assert.equal(remove(controller, made.body.refund.id).statusCode, 200);
});

test('payment-schedule-and-cancellation rule 55 reading — a refund made before a cancellation that kept nothing is refused too', () => {
  const { deps, controller } = seed();
  // The whole acompte given back: the cancellation keeps nothing and writes no avoir. `createdAt` and `cancelledAt`
  // carry the second: the cancellation is moved an hour on, as if it came later.
  const made = refund(controller, [{ key: 'accommodation', amountTtc: 274 }]);
  assert.equal(made.statusCode, 201);
  assert.equal(cancel(deps).retainedDepositAmount, 0);
  assert.equal(avoirOf(deps), undefined);
  deps.database.prepare("UPDATE reservations SET cancelledAt = datetime('now', '+1 hour') WHERE id = 10").run();
  const out = remove(controller, made.body.refund.id);
  assert.equal(out.statusCode, 409);
  assert.equal(out.body.code, 'REFUND_BEFORE_CANCELLATION');
});

test('calendar-property-parity rule 25 reading — the ledger offers « Supprimer » on a refund made after the cancellation only', () => {
  const { deps, controller } = seed();
  const early = refund(controller, [{ key: 'accommodation', amountTtc: 24 }]).body.refund;
  const earlyCash = refund(controller, [{ key: 'accommodation', amountTtc: 10 }], 'internal').body.refund;
  cancel(deps);
  const late = refund(controller, [{ key: 'accommodation', amountTtc: 50 }]).body.refund;
  const row = deps.reservationsModel.getForCancellation(10);
  const refunds = deps.refundsModel.listByReservation(10);
  const ledger = buildLedger({ row, refunds, today: TODAY });
  const rowOf = (id) => ledger.rows.find((r) => r.key === `refund-${id}`);
  assert.deepEqual(rowOf(late.id).action && rowOf(late.id).action.kind, 'deleteRefund');
  assert.equal(rowOf(late.id).action.refundId, late.id);
  assert.equal(rowOf(early.id).action, null, 'netted by the cancellation');
  assert.equal(rowOf(earlyCash.id).action, null, 'made before the cancellation');
  assert.equal(rowOf(avoirOf(deps).id).action, null, 'the retained avoir');
});
