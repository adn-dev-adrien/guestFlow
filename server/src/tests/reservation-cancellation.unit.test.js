// Cancelling a stay (specs/payment-schedule-and-cancellation.md §3.5 / §3.6), end to end against the
// real schema: the audit entry, the `kind` flip that frees the dates, the requalification pair, and
// the payment links that stop being payable.

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

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const TODAY = '2026-08-19';

function seed({ depositPaid = 1, platform = 'direct', balancePaid = 0 } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Le Lodge')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Marie', 'Dupont', 'marie@example.com')").run();
  db.prepare(`
    INSERT INTO reservations
      (id, kind, propertyId, clientId, startDate, endDate, checkInTime, checkOutTime, platform,
       finalPrice, depositAmount, depositPaid, depositPaidDate, depositDueDate,
       balanceAmount, balancePaid, balanceDueDate,
       accommodationAcompteContribTtc)
    VALUES
      (10, 'reservation', 1, 1, '2026-09-18', '2026-09-25', '15:00', '10:00', @platform,
       914, 274, @depositPaid, '2026-05-12', '2026-05-10',
       640, @balancePaid, '2026-08-09',
       274)
  `).run({ platform, depositPaid: depositPaid ? 1 : 0, balancePaid: balancePaid ? 1 : 0 });

  const deps = {
    database: db,
    reservationsModel: reservationsModelFactory.create(db),
    refundsModel: refundsModelFactory.createModel(db),
    compensationsModel: compensationsModelFactory.buildModel(db),
    paymentLinksModel: paymentLinksModelFactory.buildModel(db),
  };
  return { db, deps };
}

const cancel = (deps, overrides = {}) =>
  cancelReservation(deps, 10, { today: TODAY, vatRate: 10, reason: 'Solde jamais réglé', ...overrides });

// specs/payment-schedule-and-cancellation.md rule 23
test('the stay leaves kind=reservation, stamped with when, why and by whom', () => {
  const { db, deps } = seed();
  const out = cancel(deps, { cancelledBy: 7 });
  assert.equal(out.ok, true);
  assert.equal(out.cancellationReason, 'unpaid_balance');

  const row = db.prepare('SELECT kind, cancelledAt, cancellationReason, cancelledBy FROM reservations WHERE id = 10').get();
  assert.equal(row.kind, 'cancelled');
  assert.equal(row.cancellationReason, 'Solde jamais réglé');
  assert.equal(row.cancelledBy, 7);
  assert.ok(row.cancelledAt, 'stamped');
  db.close();
});

// specs/payment-schedule-and-cancellation.md rule 24
test('the dates go back on sale — the availability check accepts them again', () => {
  const { db, deps } = seed();
  const model = deps.reservationsModel;
  const attempt = () => model.validateAvailability(1, '2026-09-18', '2026-09-25', '15:00', '10:00', null, {}, { allowPastDates: true });
  assert.ok(attempt(), 'blocked while the stay is live');
  cancel(deps);
  assert.equal(attempt(), null, 'free once cancelled');
  db.close();
});

test('the amounts are left untouched — they are history, and accounting still reads them', () => {
  const { db, deps } = seed();
  cancel(deps);
  const row = db.prepare('SELECT depositAmount, depositPaid, depositPaidDate, balanceAmount, balanceDueDate FROM reservations WHERE id = 10').get();
  assert.equal(row.depositAmount, 274);
  assert.equal(row.depositPaid, 1);
  assert.equal(row.depositPaidDate, '2026-05-12');
  assert.equal(row.balanceAmount, 640);
  assert.equal(row.balanceDueDate, '2026-08-09');
  db.close();
});

test('a collected acompte is requalified: an avoir plus a banked indemnity', () => {
  const { db, deps } = seed();
  const out = cancel(deps);
  assert.equal(out.retainedDepositAmount, 274);
  assert.equal(out.writtenOffBalance, 640);

  const refund = db.prepare('SELECT * FROM reservation_refunds WHERE id = ?').get(out.refundId);
  assert.equal(refund.method, 'retained');
  assert.equal(refund.totalTtc, 274);
  assert.equal(refund.refundDate, TODAY);
  const lines = db.prepare('SELECT bucket, amountTtc, vatRate FROM reservation_refund_lines WHERE refundId = ?').all(out.refundId);
  assert.deepEqual(lines, [{ bucket: 'accommodation', amountTtc: 274, vatRate: 10 }]);

  const compensation = deps.compensationsModel.getById(out.compensationId);
  assert.equal(compensation.status, 'received');
  assert.equal(compensation.origin, 'retained_deposit');
  assert.equal(compensation.receivedAmount, 274);
  assert.equal(compensation.receivedDate, TODAY);
  assert.equal(compensation.cancelledStayAmount, 914);
  assert.equal(compensation.clientName, 'Marie Dupont');
  db.close();
});

// specs/payment-schedule-and-cancellation.md rule 32bis
test('the requalification avoir is not a refund to the guest — no money went back', () => {
  const { db, deps } = seed();
  cancel(deps);
  // The fiche and the finance aggregates read these totals to display « Remboursements ». A retained
  // acompte must count in neither: we KEPT the money. The journal read is separate and does see it.
  assert.deepEqual(deps.refundsModel.totalsByReservation(10), { book: 0, withCash: 0 });
  assert.equal(deps.refundsModel.listByReservation(10).length, 1, 'still visible in the register');
  db.close();
});

test('an acompte never collected requalifies nothing (rule 27)', () => {
  const { db, deps } = seed({ depositPaid: 0 });
  const out = cancel(deps);
  assert.equal(out.cancellationReason, 'unpaid_balance');
  assert.equal(out.retainedDepositAmount, 0);
  assert.equal(out.refundId, null);
  assert.equal(out.compensationId, null);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_refunds').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM cancellation_compensations').get().c, 0);
  db.close();
});

test('the cancellation is written to the reservation history', () => {
  const { db, deps } = seed();
  cancel(deps);
  const entry = db.prepare("SELECT eventType, changedFields FROM reservation_history WHERE reservationId = 10 AND eventType = 'cancel'").get();
  assert.ok(entry, 'an audit entry exists');
  const fields = JSON.parse(entry.changedFields);
  assert.deepEqual(fields.map((f) => f.field), ['kind', 'cancellationReason', 'retainedDeposit', 'writtenOffBalance']);
  assert.equal(fields.find((f) => f.field === 'retainedDeposit').to, 274);
  assert.equal(fields.find((f) => f.field === 'writtenOffBalance').to, 640);
  db.close();
});

test('open payment links are cancelled — a dead stay must not stay payable', () => {
  const { db, deps } = seed();
  deps.paymentLinksModel.create({ reservationId: 10, type: 'balance', amountCents: 64000, url: 'https://pay/x', status: 'open' });
  deps.paymentLinksModel.create({ reservationId: 10, type: 'deposit', amountCents: 27400, url: 'https://pay/y', status: 'paid' });
  cancel(deps);
  const statuses = db.prepare('SELECT type, status FROM payment_links WHERE reservationId = 10 ORDER BY type').all();
  assert.deepEqual(statuses, [
    { type: 'balance', status: 'cancelled' },
    { type: 'deposit', status: 'paid' },
  ]);
  db.close();
});

// specs/payment-schedule-and-cancellation.md rule 28
test('cancelling twice is refused, and the second call changes nothing', () => {
  const { db, deps } = seed();
  cancel(deps);
  const second = cancel(deps);
  assert.equal(second.error, 'ALREADY_CANCELLED');
  assert.equal(second.status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM cancellation_compensations').get().c, 1, 'no duplicate indemnity');
  db.close();
});

test('a platform booking is refused — it follows the iCal cancellation flow', () => {
  const { db, deps } = seed({ platform: 'Airbnb' });
  const out = cancel(deps);
  assert.equal(out.error, 'PLATFORM_RESERVATION');
  assert.equal(out.status, 403);
  assert.equal(db.prepare('SELECT kind FROM reservations WHERE id = 10').get().kind, 'reservation');
  db.close();
});

test('an unknown reservation is a 404', () => {
  const { db, deps } = seed();
  const out = cancelReservation(deps, 999, { today: TODAY, vatRate: 10 });
  assert.equal(out.error, 'NOT_FOUND');
  assert.equal(out.status, 404);
  db.close();
});

test('a fully paid stay can still be cancelled, and the reason says so', () => {
  const { db, deps } = seed({ balancePaid: 1 });
  const out = cancel(deps, { reason: '' });
  assert.equal(out.cancellationReason, 'manual');
  assert.equal(out.writtenOffBalance, 0, 'a paid solde is not written off');
  assert.equal(out.retainedDepositAmount, 274);
  db.close();
});
