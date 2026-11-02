// specs/payment-schedule-and-cancellation.md rule 55 reading of 2026-11-02 (audit R17-L1). The fiche half of the
// R16-L1 fix had no test: the suites built the ledger with a netted set of their own, so a break inside
// `nettedRefundIdsOf` (its catch returns null, the refusal falls back to id order) hid « Supprimer » on an absorbed
// refund while the DELETE route accepted it, all suites green. These cases go through `reservationsController.getById`
// on the real database, and hold the fiche to the DELETE route.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const reservations = require('../controllers/reservationsController');
const refundsController = require('../controllers/refundsController');
const reservationsModel = require('../models/reservationsModel');
const refundsModel = require('../models/refundsModel');
const compensationsModel = require('../models/cancellationCompensationsModel');
const paymentLinksModel = require('../models/paymentLinksModel');
const { cancelReservation } = require('../utils/cancelReservation');
const { localIsoDate } = require('../utils/localDate');

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localIsoDate(d); };
const TODAY = inDays(0);
const ADMIN = { role: 'admin' };

function call(handler, req) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  handler(req, res);
  return res;
}

db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte Test')").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Test')").run();

// A direct stay of 914 €: acompte 274 € and solde 640 € paid, one refund of `amount`, then the cancellation.
function cancelledStayWithRefund(id, amount) {
  db.prepare(`
    INSERT INTO reservations
      (id, kind, propertyId, clientId, startDate, endDate, platform,
       finalPrice, totalPrice, depositAmount, depositPaid, depositPaidDate, balanceAmount, balancePaid, balancePaidDate, balanceDueDate)
    VALUES (?, 'reservation', 1, 1, ?, ?, 'direct', 914, 914, 274, 1, ?, 640, 1, ?, ?)
  `).run(id, inDays(60), inDays(67), TODAY, TODAY, inDays(30));
  const made = call(refundsController.create, {
    params: { id: String(id) }, user: ADMIN,
    body: { refundDate: TODAY, method: 'transfer', lines: [{ key: 'accommodation', amountTtc: amount }] },
  });
  assert.equal(made.statusCode, 201);
  const out = cancelReservation({ database: db, reservationsModel, refundsModel, compensationsModel, paymentLinksModel }, id, { today: TODAY, vatRate: 10 });
  return { refundId: made.body.refund.id, retained: out.retainedDepositAmount };
}

function ficheAction(id, refundId) {
  const errors = [];
  const original = console.error;
  console.error = (...args) => { errors.push(args); };
  let fiche;
  try {
    fiche = call(reservations.getById, { params: { id: String(id) }, user: ADMIN, query: {} });
  } finally {
    console.error = original;
  }
  assert.equal(fiche.statusCode, 200);
  assert.deepEqual(errors, [], 'the fiche read its netted refunds without error');
  const row = fiche.body.ledger.rows.find((r) => r.key === `refund-${refundId}`);
  assert.ok(row, 'the refund is on the fiche');
  return row.action;
}

const remove = (id, refundId) => call(refundsController.remove, { params: { id: String(id), refundId: String(refundId) }, user: ADMIN });

test('payment-schedule rule 55 reading (audit R17-L1) — a 100 € refund the paid solde absorbed: the fiche offers « Supprimer » and the DELETE route deletes it', () => {
  const { refundId, retained } = cancelledStayWithRefund(10, 100);
  assert.equal(retained, 274, 'the avoir is the gross acompte');
  const action = ficheAction(10, refundId);
  assert.equal(action && action.kind, 'deleteRefund');
  assert.equal(action.refundId, refundId);
  assert.equal(remove(10, refundId).statusCode, 200, 'the DELETE route agrees with the fiche');
});

test('payment-schedule rule 55 reading (audit R17-L1) — a 700 € refund moved the avoir: no « Supprimer » on the fiche and the DELETE route refuses it', () => {
  const { refundId, retained } = cancelledStayWithRefund(11, 700);
  assert.equal(retained, 214, 'the avoir is what the refund left');
  assert.equal(ficheAction(11, refundId), null);
  assert.equal(remove(11, refundId).statusCode, 409, 'the DELETE route agrees with the fiche');
});
