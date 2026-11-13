// specs/pricing-components.md §3 rule 74 (pass 4) — « Hébergement » and « Taxe de séjour » are written live: a stay saved after the
// migration gets its two lines, and an operator edit that moves the price amends the line (`amendedAt`) and is journaled.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const controller = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');
const { syncStayLines } = require('../utils/pricingLinesMigration');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9401, 'Lignes', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9401, 'Camille', 'Lignes')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9401, 'Standard', 100)").run();

const stayLines = (id) => Object.fromEntries(db.prepare('SELECT kind, totalCents, amendedAt FROM reservation_stay_lines WHERE reservationId = ?').all(id).map((r) => [r.kind, r]));
function newStay(offset) {
  const start = addDaysToIsoDate(todayIso(), offset);
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime)
    VALUES (9401, 9401, ?, ?, 'direct', 2, 300, 300, 'reservation', '15:00')`).run(start, addDaysToIsoDate(start, 3)).lastInsertRowid);
}

test('rule 74 — syncStayLines creates the accommodation line and keeps it current, journaling nothing by itself', () => {
  const id = newStay(60);
  const created = syncStayLines(db, id);
  assert.deepEqual(created.map((c) => [c.kind, c.fromCents, c.toCents]), [['accommodation', null, 30000]]);
  assert.equal(stayLines(id).accommodation.amendedAt, null);
  assert.deepEqual(syncStayLines(db, id), [], 'a second run changes nothing');
});

test('rule 74 — an operator edit that moves the price amends the line and writes a history entry', () => {
  const id = newStay(61);
  syncStayLines(db, id);
  const result = controller.performUpdate(id, { ...storedBody(id), customPrice: 250 });
  assert.equal(result.status, 200);
  assert.equal(stayLines(id).accommodation.totalCents, 25000);
  assert.ok(stayLines(id).accommodation.amendedAt);
  const entry = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND changedFields LIKE '%stayLine:accommodation%'").get(id);
  assert.match(entry.changedFields, /300,00 €/);
  assert.match(entry.changedFields, /250,00 €/);
});

test('rule 74 — a stay saved without a line yet gets it on its first save', () => {
  const id = newStay(62);
  assert.deepEqual(stayLines(id), {});
  controller.performUpdate(id, { ...storedBody(id), customPrice: 280 });
  assert.equal(stayLines(id).accommodation.totalCents, 28000);
});
