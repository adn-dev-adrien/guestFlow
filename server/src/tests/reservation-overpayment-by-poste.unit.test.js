// specs/reservation-refunds.md rule 35 — the trop-perçu is split by poste, so its refund is booked on
// what the guest paid too much for. Review 2026-10-18 (second pass), finding 1: reservation 22304 went
// from 6 to 2 adults after being paid; the whole 14,40 € came from the tourist tax, yet the refund dialog
// opened on one « Hébergement » line — accepted as is, it debited the turnover and the VAT and left the
// tax account 14,40 € too high.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const { overpaymentLinesOf, currentByPoste } = require('../utils/overpayment');

const PAID_BALANCE = { depositPaid: 0, balancePaid: 1 };
const amounts = (lines) => Object.fromEntries(lines.map((l) => [l.bucket, l.amountTtc]));

test('rule 35 — a tax-only excess becomes one tourist-tax line', () => {
  const lines = overpaymentLinesOf({
    row: PAID_BALANCE,
    capturedByPoste: { deposit: null, balance: { accommodation: 300, options: 0, resources: 0, touristTax: 21.6 } },
    quote: { finalPrice: 300, optionsTotal: 0, resourcesTotal: 0, touristTaxTotal: 7.2 },
    overpaymentTtc: 14.4,
  });
  assert.deepEqual(lines, [{ bucket: 'touristTax', label: 'Taxe de séjour', amountTtc: 14.4, collectedTtc: 21.6, dueTtc: 7.2 }]);
});

test('rule 35 — several postes in excess share the amount, the rounding cents going to the largest', () => {
  const lines = overpaymentLinesOf({
    row: { depositPaid: 1, balancePaid: 1 },
    capturedByPoste: {
      deposit: { accommodation: 100, options: 20, resources: 0, touristTax: 5 },
      balance: { accommodation: 200, options: 40, resources: 0, touristTax: 10 },
    },
    quote: { finalPrice: 320, optionsTotal: 20, resourcesTotal: 0, touristTaxTotal: 5 },
    overpaymentTtc: 50,
  });
  assert.deepEqual(amounts(lines), { options: 40, touristTax: 10 });
  const odd = overpaymentLinesOf({
    row: PAID_BALANCE,
    capturedByPoste: { balance: { accommodation: 0, options: 10, resources: 10, touristTax: 10 } },
    quote: { finalPrice: 0, optionsTotal: 0, resourcesTotal: 0, touristTaxTotal: 0 },
    overpaymentTtc: 10,
  });
  assert.equal(odd.reduce((s, l) => Math.round((s + l.amountTtc) * 100) / 100, 0), 10, 'the total is kept to the cent');
});

test('rule 35 — no capture to read, or an unpaid bucket: the whole amount stays on the accommodation', () => {
  // Nothing says what left the stay: the accommodation, as an amount collected in excess (reservation-save-keeps-pricing.md rule 15).
  const fallback = [{ bucket: 'accommodation', label: 'Hébergement', amountTtc: 12, collectedTtc: 12, dueTtc: 0, excessOnly: true }];
  const quote = { finalPrice: 100, optionsTotal: 0, resourcesTotal: 0, touristTaxTotal: 0 };
  assert.deepEqual(overpaymentLinesOf({ row: PAID_BALANCE, capturedByPoste: { deposit: null, balance: null }, quote, overpaymentTtc: 12 }), fallback);
  assert.deepEqual(overpaymentLinesOf({
    row: { depositPaid: 0, balancePaid: 0 },
    capturedByPoste: { balance: { accommodation: 0, options: 0, resources: 0, touristTax: 50 } },
    quote, overpaymentTtc: 12,
  }), fallback);
  assert.deepEqual(overpaymentLinesOf({ row: PAID_BALANCE, capturedByPoste: {}, quote, overpaymentTtc: 0 }), []);
});

test('rule 35 — the accommodation is the sale less the options and the activities', () => {
  assert.deepEqual(currentByPoste({ finalPrice: 500, optionsTotal: 80, resourcesTotal: 20, touristTaxTotal: 9.6 }),
    { accommodation: 400, options: 80, resources: 20, touristTax: 9.6 });
});

// End to end on the real boot schema: a stay paid in full, then one adult fewer. Only the tax moves.
function respond() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

test('rule 35 — paid, then 2 → 1 adult: the refusal, the live fiche and the refund all point at the tourist tax', async () => {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  const { recordStayPayment, depsFor } = require('../utils/stayPaymentRecorder');
  const { todayIso } = require('../utils/localDate');
  const { addDaysToIsoDate } = require('../utils/devisHelpers');
  const start = addDaysToIsoDate(todayIso(), 145);
  db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson) VALUES (7, 'Lodge', 8, 'per_day_per_person', 1.2)").run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (7, 'Standard', 100)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (7, 'Camille', 'Poste')").run();
  const body = (adults, extra = {}) => ({
    propertyId: 7, clientId: 7, startDate: start, endDate: addDaysToIsoDate(start, 3),
    checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct',
    adults, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0, ...extra,
  });
  const created = respond();
  controller.create({ body: body(2), user: { role: 'admin' } }, created);
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const id = created.body.id;
  recordStayPayment(depsFor(db), { reservationId: id, bucket: 'full', paidDate: '2026-10-18' });
  const row = db.prepare('SELECT depositAmount, balanceAmount FROM reservations WHERE id = ?').get(id);
  const paidFlags = { depositPaid: true, balancePaid: true, depositAmount: row.depositAmount, balanceAmount: row.balanceAmount };

  const refused = controller.performUpdate(id, body(1, paidFlags));
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.deepEqual(refused.body.overpaymentLines, [
    { bucket: 'touristTax', label: 'Taxe de séjour', amountTtc: 3.6, collectedTtc: 7.2, dueTtc: 3.6 },
  ]);

  const live = respond();
  await controller.calculatePrice({ body: { ...body(1, paidFlags), reservationId: id }, user: { role: 'admin' } }, live);
  assert.equal(live.statusCode, 200, JSON.stringify(live.body));
  assert.equal(live.body.overpaymentTtc, 3.6);
  assert.deepEqual(live.body.overpaymentLines, refused.body.overpaymentLines, 'the fiche shows what the save refuses');

  const forced = controller.performUpdate(id, { ...body(1, paidFlags), forceOverpayment: true });
  assert.equal(forced.status, 200, JSON.stringify(forced.body));
  const after = respond();
  await controller.calculatePrice({ body: { ...body(1, paidFlags), reservationId: id }, user: { role: 'admin' } }, after);
  assert.deepEqual(after.body.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['touristTax', 3.6]],
    'still on the tax once saved: the refund dialog opens on it');
});
