// specs/pricing-components.md §3 rules 12, 31 and 74 — `saleDetail` reads a stored stay as it was sold: a stored line bills what it stores and
// the accommodation is what the stored stay price leaves, even when today's engine would price the stay otherwise (a resource line priced before
// the hourly grid, a platform stay whose payout moved). Measured on the prod copy of 2026-11-11: every stay's detail now sums to its stored
// price and tax, line by line.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9601, 'Figés', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9601, 'Camille', 'Figée')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9601, 'Standard', 100)").run();
const bath = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Bain nordique', 40, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9601, ?)').run(bath);

function soldStay() {
  const startDate = addDaysToIsoDate(todayIso(), 10);
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime, balanceDueDate)
    VALUES (9601, 9601, ?, ?, 'direct', 2, 400, 400, 'reservation', '15:00', ?)`).run(startDate, addDaysToIsoDate(startDate, 4), startDate).lastInsertRowid);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${bath}`, quantity: 1 }]).status, 200);
  return id;
}
const lineOf = (detail, label) => detail.lines.find((line) => line.label === label);

test('rule 74 — a line stored at another amount than the engine gives today bills its stored amount', () => {
  const id = soldStay();
  db.prepare('UPDATE reservation_options SET totalPrice = 50 WHERE reservationId = ?').run(id);
  db.prepare('UPDATE reservations SET finalPrice = 450 WHERE id = ?').run(id);
  const detail = extraSale.saleDetailOf(id);
  assert.deepEqual([lineOf(detail, 'Bain nordique').totalCents, lineOf(detail, 'Bain nordique').grossCents], [5000, 5000]);
  assert.equal(lineOf(detail, 'Hébergement').totalCents, 40000);
  assert.equal(detail.totals.totalCents, 45000);
});

test('rule 31 — a stay whose stored price drifted from the engine reads as sold: the accommodation is what the stored price leaves', () => {
  const id = soldStay();
  db.prepare('UPDATE reservations SET finalPrice = 380 WHERE id = ?').run(id);
  const detail = extraSale.saleDetailOf(id);
  assert.equal(lineOf(detail, 'Hébergement').totalCents, 34000);
  assert.equal(lineOf(detail, 'Bain nordique').totalCents, 4000);
  assert.equal(detail.totals.totalCents, 38000);
});

test('rule 74 — a stay the engine still agrees with is unchanged', () => {
  const id = soldStay();
  const detail = extraSale.saleDetailOf(id);
  assert.deepEqual([lineOf(detail, 'Hébergement').totalCents, lineOf(detail, 'Bain nordique').totalCents, detail.totals.totalCents], [40000, 4000, 44000]);
});

test('rule 14 — an offered line stays at 0, whatever its stored amount', () => {
  const id = soldStay();
  const ref = lineOf(extraSale.saleDetailOf(id), 'Bain nordique').ref;
  assert.equal(extraSale.changeLine(id, ref, { offered: true }).status, 200);
  const detail = extraSale.saleDetailOf(id);
  assert.equal(lineOf(detail, 'Bain nordique').totalCents, 0);
  assert.equal(detail.totals.totalCents, 40000);
});
