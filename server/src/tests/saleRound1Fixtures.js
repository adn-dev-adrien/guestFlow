// Shared fixtures of the round-1 sale suites (sale-custom-line-identity, sale-move-before-arrival, sale-breakfast-card-before-arrival,
// sale-installments-pinned, sale-quote-payment-refusals): one lodging, one option, one breakfast, a stay relative to today. Not a test file.
const db = require('../database');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9701, 'Ronde', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9701, 'Test', 'Ronde')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9701, 'Standard', 100)").run();
const beer = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Bière ronde', 6, 'per_stay')").run().lastInsertRowid);
const breakfast = Number(db.prepare(`INSERT INTO options (title, price, priceType, autoOptionType, category, breakfastTime)
  VALUES ('Petit déjeuner ronde', 10, 'per_person_per_night', 'breakfast', 'Restauration', '09:00')`).run().lastInsertRowid);
for (const option of [beer, breakfast]) db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9701, ?)').run(option);

/** A direct stay of 3 nights starting `daysAhead` days from today (negative: started, the guest checked in). */
function stay(daysAhead = 20, { adults = 2 } = {}) {
  const start = addDaysToIsoDate(todayIso(), daysAhead);
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime, checkInDone, balanceDueDate)
    VALUES (9701, 9701, ?, ?, 'direct', ?, 300, 300, 'reservation', '15:00', ?, ?)`).run(start, addDaysToIsoDate(start, 3), adults, daysAhead <= 0 ? 1 : 0, start).lastInsertRowid);
}

const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const morning = (id, n) => addDaysToIsoDate(row(id).startDate, n);

module.exports = { db, beer, breakfast, stay, row, morning, todayIso, addDaysToIsoDate };
