// specs/pricing/pricing-components.md §3 rule 25, reading 2026-11-18 (loop t18 O18-1) — a custom line of the line API is judged by the engine's own
// priced-line predicate (`isPricedCustomLine`: a label and at least one cent). Before, `customRequest` took any `amount > 0`: 0.004 € answered
// 200 « totalCents 0 », wrote no line (the engine drops it) and still left a « Vente : Ligne complétée » history entry. Every amount of the table
// is played through both entry points that parse a custom request (`quote`, `sell`), before and during the stay: the sale is accepted exactly
// when the predicate prices the line, and a refused one writes no line and no history.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const { isPricedCustomLine } = require('../utils/pricing/storedLines');
const { toCents } = require('../utils/pricing/money');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9601, 'Centimes', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9601, 'Alex', 'Centime')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9601, 'Standard', 100)").run();

function stayStarting(offsetDays) {
  const startDate = addDaysToIsoDate(todayIso(), offsetDays);
  const endDate = addDaysToIsoDate(startDate, 4);
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime, balanceDueDate)
    VALUES (9601, 9601, ?, ?, 'direct', 2, 400, 400, 'reservation', '15:00', ?)`).run(startDate, endDate, startDate).lastInsertRowid);
}
const customRows = (id) => db.prepare('SELECT description, amount FROM reservation_custom_options WHERE reservationId = ?').all(id);
const saleHistory = (id) => db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ? AND changedFields LIKE ?').all(id, '%"extraSale"%');

const AMOUNTS = [0.001, 0.004, 0.0049, 0.005, 0.006, 0.01, 0.014, 1.234, 0, -0.004, -0.01];
const LABELS = ['Bois', '   '];
const MOMENTS = [['before the stay', 5], ['during the stay', -1]];

for (const [moment, offset] of MOMENTS) {
  for (const label of LABELS) {
    for (const amount of AMOUNTS) {
      const priced = isPricedCustomLine({ description: label, amount });
      test(`${moment}: « ${label} » at ${amount} € is ${priced ? 'sold' : 'refused'}, as the engine prices it`, () => {
        const id = stayStarting(offset);
        const request = [{ articleRef: 'custom', label, amount }];
        const quoted = extraSale.quote(id, request);
        const sold = extraSale.sell(id, request, { source: 'sas' });
        if (priced) {
          assert.equal(quoted.status, 200);
          assert.equal(sold.status, 200);
          assert.equal(sold.totalCents, toCents(amount));
          assert.deepEqual(customRows(id), [{ description: label.trim(), amount: toCents(amount) / 100 }]);
          assert.equal(saleHistory(id).length, 1);
        } else {
          assert.equal(quoted.status, 400);
          assert.equal(quoted.body.code, 'INVALID_REQUEST');
          assert.equal(sold.status, 400);
          assert.equal(sold.body.code, 'INVALID_REQUEST');
          assert.deepEqual(customRows(id), []);
          assert.deepEqual(saleHistory(id), []);
        }
      });
    }
  }
}

test('the table holds both sides of the half-cent boundary', () => {
  assert.ok(AMOUNTS.some((amount) => amount > 0 && !isPricedCustomLine({ description: 'Bois', amount })), 'a positive amount under half a cent');
  assert.ok(AMOUNTS.some((amount) => amount < 0.01 && isPricedCustomLine({ description: 'Bois', amount })), 'an amount rounded up to one cent');
});
