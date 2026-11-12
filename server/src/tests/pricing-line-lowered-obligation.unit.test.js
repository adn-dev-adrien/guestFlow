// specs/pricing-components.md §3 rules 14, 23 and decision O-10 — offering (or discounting) a PAID line is refused by default
// (409 OVERPAID, nothing written); confirmed, it opens an obligation `lineLowered` of the line's excess, the same figure as
// the fiche save's. The SAS cannot reach a paid line: a paid complement freezes its lines (rule 32).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const obligations = require('../models/refundObligationsModel');
const { syncStay } = require('../utils/paymentAllocationsSync');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9301, 'Baisse', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9301, 'Camille', 'Baisse')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9301, 'Standard', 100)").run();
const optionId = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Bain nordique', 40, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9301, ?)').run(optionId);

function paidStay() {
  const start = addDaysToIsoDate(todayIso(), 40);
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime,
      balanceAmount, balancePaid, balancePaidDate, accommodationSoldeContribTtc)
    VALUES (9301, 9301, ?, ?, 'direct', 2, 300, 340, 'reservation', '15:00', 340, 1, '2026-11-01', 300)`).run(start, addDaysToIsoDate(start, 3)).lastInsertRowid);
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement, soldeContribTtc)
    VALUES (?, ?, 1, 40, 1, 'per_stay', 40, 0, 0, 40)`).run(id, optionId);
  syncStay(db, id);
  return id;
}
const refOf = (id) => `option:${db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ?').get(id).lineId}`;

test('rule 23 — offering a paid line is refused (409 OVERPAID) and nothing is written', () => {
  const id = paidStay();
  const result = extraSale.changeLine(id, refOf(id), { offered: true });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'OVERPAID');
  assert.equal(result.body.overpaymentTtc, 40);
  assert.equal(db.prepare('SELECT offered FROM reservation_options WHERE reservationId = ?').get(id).offered, 0);
  assert.equal(obligations.openAmountFor(id, 'lineLowered'), 0);
});

test('rules 23, 75 — confirmed, the line is offered and its excess is owed back as one open obligation', () => {
  const id = paidStay();
  const result = extraSale.changeLine(id, refOf(id), { offered: true }, { forceOverpayment: true });
  assert.equal(result.status, 200);
  assert.equal(db.prepare('SELECT offered FROM reservation_options WHERE reservationId = ?').get(id).offered, 1);
  assert.equal(obligations.openAmountFor(id, 'lineLowered'), 4000);
  assert.equal(obligations.openFor(id)[0].origin, 'lineLowered');
});

test('rule 39 — discounting a paid line is refused the same way, and the excess is the discount', () => {
  const id = paidStay();
  const refused = extraSale.changeLine(id, refOf(id), { discount: { amount: 10 } });
  assert.equal(refused.body.code, 'OVERPAID');
  assert.equal(refused.body.overpaymentTtc, 10);
  assert.equal(db.prepare('SELECT discountCents FROM reservation_options WHERE reservationId = ?').get(id).discountCents, 0);
  extraSale.changeLine(id, refOf(id), { discount: { amount: 10 } }, { forceOverpayment: true });
  assert.equal(obligations.openAmountFor(id, 'lineLowered'), 1000);
});
