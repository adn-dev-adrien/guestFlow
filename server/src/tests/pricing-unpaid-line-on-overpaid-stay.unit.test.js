// specs/pricing-components.md §3 rule 23, owner reading 2026-11-16 (S-8) — on an already over-collected stay, offering or removing an
// UNPAID line is allowed and grows the trop-perçu by exactly that line; a PAID line keeps its 409 OVERPAID.
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

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9311, 'Trop', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9311, 'Camille', 'Trop')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9311, 'Standard', 100)").run();
const optionId = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Bain nordique', 40, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9311, ?)').run(optionId);

// A stay priced 340 (nights 300 + a 40 line) whose 380 balance was collected: 40 already over-collected, and the option line is unpaid.
function overpaidStay() {
  const start = addDaysToIsoDate(todayIso(), 40);
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime,
      balanceAmount, balancePaid, balancePaidDate, accommodationSoldeContribTtc)
    -- date-literal-ok — fixture rows written by raw SQL and read back by key, no write path checks them against today
    VALUES (9311, 9311, ?, ?, 'direct', 2, 300, 340, 'reservation', '15:00', 380, 1, '2026-11-01', 300)`).run(start, addDaysToIsoDate(start, 3)).lastInsertRowid);
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement, soldeContribTtc)
    VALUES (?, ?, 1, 40, 1, 'per_stay', 40, 0, 0, 0)`).run(id, optionId);
  syncStay(db, id);
  return id;
}
const refOf = (id) => `option:${db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ?').get(id).lineId}`;
const excessCents = (id) => Math.round((db.prepare('SELECT balanceAmount - finalPrice d FROM reservations WHERE id = ?').get(id).d) * 100);

test('rule 23 — offering an unpaid line on an over-collected stay is allowed, the excess grows by the line, no obligation', () => {
  const id = overpaidStay();
  const before = excessCents(id);
  const line = extraSale.changeLine(id, refOf(id), { offered: true }, {});
  assert.equal(excessCents(id) - before, 4000);
  assert.equal(line.status, 200, JSON.stringify(line.body));
  assert.equal(db.prepare('SELECT offered FROM reservation_options WHERE reservationId = ?').get(id).offered, 1);
  assert.equal(obligations.openAmountFor(id, 'lineLowered'), 0);
});

test('rule 23 — removing an unpaid line on an over-collected stay is allowed', () => {
  const id = overpaidStay();
  const before = excessCents(id);
  const removed = extraSale.removeLine(id, refOf(id), {});
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservation_options WHERE reservationId = ?').get(id).n, 0);
  assert.equal(excessCents(id) - before, 4000);
});

test('rule 23 — discounting an unpaid line is allowed too', () => {
  const id = overpaidStay();
  const result = extraSale.changeLine(id, refOf(id), { discount: { amount: 10 } }, {});
  assert.equal(result.status, 200, JSON.stringify(result.body));
});

test('rule 23 — a PAID line keeps its refusal (the exemption follows the line\'s own settled amount)', () => {
  const id = overpaidStay();
  db.prepare('UPDATE reservations SET balanceAmount = 340 WHERE id = ?').run(id);
  db.prepare('UPDATE reservations SET accommodationSoldeContribTtc = 300 WHERE id = ?').run(id);
  db.prepare('UPDATE reservation_options SET soldeContribTtc = 40 WHERE reservationId = ?').run(id);
  syncStay(db, id);
  const refused = extraSale.changeLine(id, refOf(id), { offered: true }, {});
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'OVERPAID');
  assert.equal(extraSale.removeLine(id, refOf(id), {}).body.code, 'LINE_PAID');
});
