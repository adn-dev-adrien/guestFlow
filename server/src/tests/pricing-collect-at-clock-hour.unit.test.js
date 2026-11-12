// specs/pricing-components.md §3 rules 19, 20 and 45 — a sale on the arrival day is routed by the stay clock's hour, not by the day:
// before the check-in hour it is collected at arrival, from the check-in hour on it is collected at departure.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9301, 'Horloge', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9301, 'Camille', 'Horloge')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9301, 'Standard', 100)").run();
const bath = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Bain nordique', 40, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9301, ?)').run(bath);

function arrivalToday() {
  const startDate = todayIso();
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime, balanceDueDate)
    VALUES (9301, 9301, ?, ?, 'direct', 2, 300, 300, 'reservation', '15:00', ?)`).run(startDate, addDaysToIsoDate(startDate, 3), startDate).lastInsertRowid);
}
const at = (hour) => new Date(`${todayIso()}T${hour}:00+01:00`);
const sellAt = (hour) => {
  const id = arrivalToday();
  const result = extraSale.sell(id, [{ articleRef: `option:${bath}`, quantity: 1 }], { source: 'fiche', now: at(hour) });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return { id, row: db.prepare('SELECT collectAt, collectAtDefault FROM reservation_options WHERE reservationId = ?').get(id) };
};

test('rule 19 — a sale on the arrival day before the check-in hour is collected at arrival', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: at('10:00').getTime() });
  const { id, row } = sellAt('10:00');
  assert.deepEqual([row.collectAt, row.collectAtDefault], ['arrival', 'arrival']);
  const stay = db.prepare('SELECT complementAmount, endOfStayComplementAmount FROM reservations WHERE id = ?').get(id);
  assert.deepEqual([stay.complementAmount, stay.endOfStayComplementAmount || 0], [40, 0]);
});

test('rules 20 and 45 — from the check-in hour on, the same sale is collected at departure', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: at('17:00').getTime() });
  const { id, row } = sellAt('17:00');
  assert.deepEqual([row.collectAt, row.collectAtDefault], ['departure', 'departure']);
  const stay = db.prepare('SELECT complementAmount, endOfStayComplementAmount FROM reservations WHERE id = ?').get(id);
  assert.deepEqual([stay.complementAmount || 0, stay.endOfStayComplementAmount], [0, 40]);
});
