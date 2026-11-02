// specs/payment-schedule-and-cancellation.md rule 55 and specs/reservation-refunds.md rule 6, readings of 2026-11-02
// (audit R16-L1). Every book refund made before a cancellation's `retained` avoir was refused deletion, by id order,
// with « Remboursement déduit de l’acompte conservé. » — even when the paid solde had absorbed it whole and the avoir
// was the gross acompte, untouched by it. Now a refund is refused only when it moved the avoir: rebuilt without it, the
// requalification would keep another total or other lines. The DELETE route and the fiche's ledger agree.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { cancelReservation, cancellationNettedRefundIds } = require('../utils/cancelReservation');
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
function seed({ balancePaid = 1 } = {}) {
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
    database: db, refundsModel: deps.refundsModel, reservationsModel: deps.reservationsModel, vatRateOf: () => 10, storedOverpaymentTtc: () => 0,
  });
  return { deps, controller };
}

function call(handler, req) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  handler(req, res);
  return res;
}
const cancel = (deps) => cancelReservation(deps, 10, { today: TODAY, vatRate: 10 });
const refund = (controller, lines) => call(controller.create, { params: { id: '10' }, body: { refundDate: TODAY, method: 'transfer', lines } });
const remove = (controller, refundId) => call(controller.remove, { params: { id: '10', refundId: String(refundId) } });
const registerOf = (controller) => call(controller.list, { params: { id: '10' } }).body;
const avoirOf = (deps) => deps.refundsModel.listByReservation(10).find((r) => r.method === 'retained');
const avoirLines = (deps) => avoirOf(deps).lines.map((l) => [l.lineKey, l.amountTtc, l.unitPrice]);
const lineReading = (register) => register.refundableLines.filter((l) => l.key === 'accommodation').map((l) => [l.refundableTtc, l.indemnityTtc]);
function ledgerAction(deps, refundId) {
  const refunds = deps.refundsModel.listByReservation(10);
  const nettedRefundIds = cancellationNettedRefundIds(deps, 10, refunds, 10);
  const ledger = buildLedger({ row: deps.reservationsModel.getForCancellation(10), refunds, nettedRefundIds, today: TODAY });
  return ledger.rows.find((r) => r.key === `refund-${refundId}`).action;
}

test('payment-schedule rule 55 reading (audit R16-L1) — a refund the paid solde absorbed whole is deleted, by the API and on the fiche', () => {
  const { deps, controller } = seed();
  const made = refund(controller, [{ key: 'accommodation', amountTtc: 100 }]);
  assert.equal(made.statusCode, 201);
  assert.equal(cancel(deps).retainedDepositAmount, 274, 'the avoir is the gross acompte');
  assert.deepEqual(avoirLines(deps), [['accommodation', 274, 274]]);
  const before = registerOf(controller);
  assert.equal(before.collectedTtc, 814);
  assert.deepEqual(lineReading(before), [[814, 274]]);
  assert.equal(ledgerAction(deps, made.body.refund.id).kind, 'deleteRefund', 'the fiche offers « Supprimer »');

  const out = remove(controller, made.body.refund.id);
  assert.equal(out.statusCode, 200);
  // The register stays coherent: the sale money is back, the indemnity and the avoir are untouched.
  assert.equal(out.body.collectedTtc, 914);
  assert.deepEqual(lineReading(out.body), [[914, 274]]);
  assert.deepEqual(avoirLines(deps), [['accommodation', 274, 274]]);
  assert.equal(deps.refundsModel.listByReservation(10).length, 1, 'only the avoir is left');
});

test('payment-schedule rule 55 reading (audit R16-L1) — a refund the paid solde absorbed only in part moved the avoir: refused, on the fiche too', () => {
  const { deps, controller } = seed();
  const made = refund(controller, [{ key: 'accommodation', amountTtc: 700 }]);
  assert.equal(made.statusCode, 201);
  assert.equal(cancel(deps).retainedDepositAmount, 214, 'the acompte lost Σ given − Σ collected by the solde');
  assert.equal(ledgerAction(deps, made.body.refund.id), null);
  const out = remove(controller, made.body.refund.id);
  assert.equal(out.statusCode, 409);
  assert.equal(out.body.code, 'REFUND_NETTED_BY_CANCELLATION');
  assert.equal(deps.refundsModel.listByReservation(10).length, 2, 'nothing was deleted');
});

test('payment-schedule rule 55 reading (audit R16-L1) — with no solde paid, a refund before the avoir came off the acompte: refused', () => {
  const { deps, controller } = seed({ balancePaid: 0 });
  const made = refund(controller, [{ key: 'accommodation', amountTtc: 24 }]);
  assert.equal(cancel(deps).retainedDepositAmount, 250);
  assert.equal(ledgerAction(deps, made.body.refund.id), null);
  assert.equal(remove(controller, made.body.refund.id).body.code, 'REFUND_NETTED_BY_CANCELLATION');
});

test('payment-schedule rule 55 reading (audit R16-L1) — two refunds the solde held together: each one alone moves nothing, deleted one after the other', () => {
  const { deps, controller } = seed();
  const first = refund(controller, [{ key: 'accommodation', amountTtc: 300 }]).body.refund;
  const second = refund(controller, [{ key: 'accommodation', amountTtc: 300 }]).body.refund;
  assert.equal(cancel(deps).retainedDepositAmount, 274);
  assert.equal(remove(controller, first.id).statusCode, 200);
  assert.equal(remove(controller, second.id).statusCode, 200);
  assert.equal(registerOf(controller).collectedTtc, 914);
});
