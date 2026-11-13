// Shared by the suites of rule 85 (`true-lines-duplicate-rows`, in core and in the plugins): a stay holding TWO rows of one article.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const db = require('../database');
const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
const { calculateReservationQuote } = require('../utils/pricing');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const { todayIso } = require('../utils/localDate');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9301, 'Doublons', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9301, 'Camille', 'Doublon')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9301, 'Standard', 100)").run();
const optionId = (title, price, priceType = 'per_stay') => {
  const id = Number(db.prepare('INSERT INTO options (title, price, priceType) VALUES (?, ?, ?)').run(title, price, priceType).lastInsertRowid);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9301, ?)').run(id);
  return id;
};
const bath = optionId('Bain nordique', 40);
const wine = optionId('Panier vin', 25);

// A stay holding two rows of `bath`: the first sold at 40, the second (a later sale) at 45 × 2 = 90, plus one row of `wine`.
function stayWithTwoSales({ startOffset = 20 } = {}) {
  const startDate = addDaysToIsoDate(todayIso(), startOffset);
  const endDate = addDaysToIsoDate(startDate, 3);
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime)
    VALUES (9301, 9301, ?, ?, 'direct', 2, 300, 430, 'reservation', '15:00')`).run(startDate, endDate).lastInsertRowid);
  const insert = db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice)
    VALUES (?, ?, ?, ?, ?, 'per_stay', ?)`);
  insert.run(id, bath, 1, 40, 1, 40);
  insert.run(id, bath, 2, 45, 2, 90);
  insert.run(id, wine, 1, 25, 1, 25);
  return id;
}
const rowsOf = (id) => db.prepare('SELECT lineId, optionId, quantity, totalPrice, offered, acompteContribTtc, soldeContribTtc FROM reservation_options WHERE reservationId = ? ORDER BY lineId').all(id);
const quoteOf = (id) => calculateReservationQuote(buildReservationEngineInput(db, db.prepare('SELECT * FROM reservations WHERE id = ?').get(id)));

module.exports = { db, optionId, bath, wine, stayWithTwoSales, rowsOf, quoteOf };
