// specs/reservation-refunds.md rule 34 — a stay reduced below what the guest already paid is a
// trop-perçu: the save says so with the amount the server computed, and the fiche offers the refund.
// Review 2026-10-18, F3: reservation 22296 had 798,20 € received online and a solde lowered to 665 €,
// with nothing on the fiche to say so.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const { collectedOnSchedule, overpaymentOf } = require('../utils/overpayment');

const PAID_BALANCE = { depositPaid: 0, depositAmount: 0, balancePaid: 1, balanceAmount: 665 };

test('rule 34 — a paid bucket counts what its captured contribs collected, not the lowered stored amount', () => {
  assert.equal(collectedOnSchedule(PAID_BALANCE, { deposit: null, balance: 798.2 }), 798.2);
  assert.equal(overpaymentOf({ row: PAID_BALANCE, captured: { balance: 798.2 } }), 133.2);
});

test('rule 34 — without a capture the stored amount is the collected one; unpaid buckets count nothing', () => {
  assert.equal(collectedOnSchedule(PAID_BALANCE, { deposit: null, balance: null }), 665);
  assert.equal(collectedOnSchedule({ depositPaid: 0, depositAmount: 300, balancePaid: 0, balanceAmount: 500 }, {}), 0);
  assert.equal(overpaymentOf({ row: { depositPaid: 1, depositAmount: 300, balanceAmount: 500 }, captured: null }), 0);
});

test('rule 34 — caisse interne is money received; refunds already given back are netted', () => {
  const row = { ...PAID_BALANCE, balancePaid: 0, balancePaidCash: 1 };
  assert.equal(overpaymentOf({ row, captured: { balance: 798.2 } }), 133.2);
  assert.equal(overpaymentOf({ row, captured: { balance: 798.2 }, refundedTtc: 100 }), 33.2);
  assert.equal(overpaymentOf({ row, captured: { balance: 798.2 }, refundedTtc: 200 }), 0);
});

test('rule 34 — the new schedule is what the save would store', () => {
  const row = { depositPaid: 1, depositAmount: 240, balancePaid: 0, balanceAmount: 560 };
  const captured = { deposit: 240, balance: null };
  assert.equal(overpaymentOf({ row, captured, depositAmount: 60, balanceAmount: 140 }), 40);
  assert.equal(overpaymentOf({ row, captured, depositAmount: 100, balanceAmount: 300 }), 0);
});

// End to end on the real boot schema: a solde paid online, then a save with fewer guests.
function fixture() {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  const { recordStayPayment, depsFor } = require('../utils/stayPaymentRecorder');
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled)
              VALUES (1, 'Gîte', 8, 'per_day_per_person', 4, 0)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  const optionId = db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Petit déjeuner test', 'per_person_per_night', 8)").run().lastInsertRowid;
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(optionId);
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
  const body = (adults) => ({
    propertyId: 1, clientId: 1, startDate: '2027-01-24', endDate: '2027-01-27',
    checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct',
    adults, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0,
    depositDisabled: 1, options: [{ optionId, quantity: 1 }],
  });
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.create({ body: body(6), user: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const id = res.body.id;
  recordStayPayment(depsFor(db), { reservationId: id, bucket: 'balance', paidDate: '2026-10-18', keepPaymentOnCaptureFailure: true });
  return { db, controller, id, body };
}

test('rule 34 — paid online, then reduced: 409 OVERPAID with the amount, saved once confirmed, then offered as a refund', async () => {
  const { db, controller, id, body } = fixture();
  const paid = db.prepare('SELECT balanceAmount FROM reservations WHERE id = ?').get(id).balanceAmount;

  const refused = controller.performUpdate(id, body(2));
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.code, 'OVERPAID');
  assert.ok(refused.body.overpaymentTtc > 0);
  assert.match(refused.body.error, /^Trop-perçu : \d+,\d{2} € déjà encaissés au-delà du nouveau total\.$/);
  assert.equal(db.prepare('SELECT adults FROM reservations WHERE id = ?').get(id).adults, 6, 'nothing written');

  const forced = controller.performUpdate(id, { ...body(2), forceOverpayment: true });
  assert.equal(forced.status, 200, JSON.stringify(forced.body));
  const after = db.prepare('SELECT balanceAmount FROM reservations WHERE id = ?').get(id).balanceAmount;
  assert.equal(after, paid, 'rule 36 — the paid solde keeps what it collected');
  const expected = refused.body.overpaymentTtc;

  const refunds = require('../controllers/refundsController');
  assert.equal(await liveOverpayment(controller, id, body(2)), expected, 'the fiche shows the trop-perçu');

  // An unrelated save of a stay already over-collected is not stopped again.
  const again = controller.performUpdate(id, { ...body(2), notes: 'Arrivée tardive' });
  assert.equal(again.status, 200, JSON.stringify(again.body));

  // Once refunded, there is nothing left to warn about.
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  refunds.create({
    params: { id },
    body: { refundDate: '2026-10-18', method: 'transfer', reason: '', lines: [{ label: 'Trop-perçu', bucket: 'options', amountTtc: expected }] },
  }, res);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(await liveOverpayment(controller, id, body(2)), 0);
});

// The quote the fiche asks for carries the live trop-perçu.
async function liveOverpayment(controller, id, body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await controller.calculatePrice({ body: { ...body, selectedOptions: body.options, reservationId: id }, user: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.overpaymentTtc;
}

// The engine keeps a paid acompte and solde frozen: reducing the stay afterwards leaves them above the
// new total (browser check 2026-10-18 — 1 adult fewer, 3,60 € of tourist tax, nothing said).
test('rule 34 — acompte and solde paid, then the stay reduced: the frozen excess is a trop-perçu', async () => {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  db.prepare("INSERT OR IGNORE INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson) VALUES (2, 'Lodge', 8, 'per_day_per_person', 1.2)").run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (2, 'Standard', 100)").run();
  const body = (adults, extra = {}) => ({
    propertyId: 2, clientId: 1, startDate: '2027-02-24', endDate: '2027-02-27',
    checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct',
    adults, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0, ...extra,
  });
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.create({ body: body(2), user: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const id = res.body.id;
  const row = db.prepare('SELECT depositAmount, balanceAmount, touristTaxTotal FROM reservations WHERE id = ?').get(id);
  const { recordStayPayment, depsFor } = require('../utils/stayPaymentRecorder');
  recordStayPayment(depsFor(db), { reservationId: id, bucket: 'full', paidDate: '2026-10-18' });

  const paidFlags = { depositPaid: true, balancePaid: true, depositAmount: row.depositAmount, balanceAmount: row.balanceAmount };
  assert.equal(await liveOverpayment(controller, id, body(2, paidFlags)), 0, 'nothing in excess before the change');
  const refused = controller.performUpdate(id, body(1, paidFlags));
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.code, 'OVERPAID');
  assert.equal(refused.body.overpaymentTtc, 3.6, 'one adult × 3 nights × 1,20 €');
  assert.equal(await liveOverpayment(controller, id, body(1, paidFlags)), 3.6);
});
