// specs/pricing-components.md rule 75 and owner decision O-6 (loop t2 B2-5) — only a refund opened on the trop-perçu lowers it, so only that refund settles
// the `lineLowered` rows. A refund made on a line (the lowered one or another) leaves the trop-perçu where it was, and the register says the same: the row
// stays open, at the trop-perçu.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const obligations = require('../models/refundObligationsModel');
const refundsController = require('../controllers/refundsController');
const reservationsController = require('../controllers/reservationsController');
const { syncStay } = require('../utils/paymentAllocationsSync');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9311, 'Baisse B2-5', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9311, 'Camille', 'Baisse')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9311, 'Standard', 100)").run();
const optionId = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Bain nordique', 40, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9311, ?)').run(optionId);

function loweredStay(change) {
  const start = addDaysToIsoDate(todayIso(), 40);
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime,
      balanceAmount, balancePaid, balancePaidDate, accommodationSoldeContribTtc)
    VALUES (9311, 9311, ?, ?, 'direct', 2, 300, 340, 'reservation', '15:00', 340, 1, ?, 300)`).run(start, addDaysToIsoDate(start, 3), todayIso()).lastInsertRowid);
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement, soldeContribTtc)
    VALUES (?, ?, 1, 40, 1, 'per_stay', 40, 0, 0, 40)`).run(id, optionId);
  syncStay(db, id);
  const ref = `option:${db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ?').get(id).lineId}`;
  assert.equal(extraSale.changeLine(id, ref, change, { forceOverpayment: true }).status, 200);
  return id;
}

function call(handler, id, body, extra = {}) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  handler({ params: { id: String(id), ...extra }, body }, res);
  return res;
}

const overCents = (id) => Math.round(reservationsController.storedOverpayment(id).overpaymentTtc * 100);

for (const [name, change, refundCents, pick] of [
  ['the line offered, a refund on the accommodation', { offered: true }, 4000, (lines) => lines.find((line) => line.key === 'accommodation')],
  ['the line discounted, a refund on the lowered line itself', { discount: { amount: 10 } }, 1000, (lines) => lines.find((line) => line.key !== 'accommodation')],
]) {
  test(`B2-5 — ${name}: the trop-perçu and the open row stay equal`, () => {
    const id = loweredStay(change);
    assert.equal(obligations.openAmountFor(id, 'lineLowered'), refundCents);
    assert.equal(overCents(id), refundCents);
    const line = pick(call(refundsController.list, id).body.refundableLines);
    const made = call(refundsController.create, id, { refundDate: todayIso(), method: 'transfer', lines: [{ key: line.key, amountTtc: refundCents / 100 }] });
    assert.equal(made.statusCode, 201, JSON.stringify(made.body));
    assert.equal(overCents(id), refundCents, 'O-6: a line refund does not lower the trop-perçu');
    assert.equal(obligations.openAmountFor(id, 'lineLowered'), refundCents, 'so the register still owes it');
  });
}
