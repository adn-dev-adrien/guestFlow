// specs/guest-app.md rule 96 (fourth pass, 2026-11-10) — an order merged into a line the stay already holds at an older price never
// drifts by a cent: the order's units are billed exactly at the catalogue price of the day (never the average of the merged line),
// the quote, the charge, the stored order and the stay's growth all read the same amount.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./hourlyResourcesFixture').liveHourlyResources();

const db = require('../database');
const { priceOrder, commitOrder } = require('../utils/midStayOrderCommit');

const named = (ref) => ({ source: 'shopOrder', ref, history: { field: 'shopOrder', label: 'Commande boutique', text: `Commande boutique #${ref}` } });
const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, depositEnabled) VALUES (1, 'Gîte', 8, 'none', 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (18, 'Cidre', 7, 'per_stay')").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 18)').run();

let sequence = 0;
function seedStayHolding(quantity, unitPrice) {
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
       doubleBeds, babyBeds, complementPaid, cautionAmount, balanceDueDate, balancePaid, reservationNumber)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, 'direct', 800, 0, ?, 0, ?, 1, 0, 'reservation', 0, '16:00', '10:00', 0, 0, 0, 0, 0, ?, 1, ?)`)
    .run(isoPlus(5), isoPlus(9), 800 + quantity * unitPrice, 800 + quantity * unitPrice, isoPlus(3), `2026${String(++sequence).padStart(5, '0')}`).lastInsertRowid);
  for (let i = 5; i < 9; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 200)").run(id, isoPlus(i));
  }
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (?, 18, ?, ?, ?, 'per_stay', ?)")
    .run(id, quantity, unitPrice, quantity, quantity * unitPrice);
  return id;
}

for (const [held, ordered] of [[1, 2], [3, 1], [2, 5]]) {
  test(`rule 96 (LOW 3): the stay holds ${held} × 6,50 €, the catalogue is at 7 € — an order of ${ordered} is quoted, charged and grown by exactly ${ordered} × 7 €`, () => {
    const id = seedStayHolding(held, 6.5);
    const lines = [{ kind: 'option', id: 18, quantity: ordered }];
    const priced = priceOrder(id, lines);
    assert.equal(priced.status, 200, JSON.stringify(priced.body));
    assert.equal(priced.total, ordered * 7, `quoted ${priced.total}`);
    const before = db.prepare('SELECT finalPrice, complementAmount FROM reservations WHERE id = ?').get(id);
    const result = commitOrder(id, { ...named(id), lines });
    assert.deepEqual([result.status, result.total], [200, ordered * 7], JSON.stringify(result.body));
    const after = db.prepare('SELECT finalPrice, complementAmount FROM reservations WHERE id = ?').get(id);
    assert.equal(Math.round((after.finalPrice - before.finalPrice) * 100), ordered * 700);
    assert.equal(Math.round((after.complementAmount - before.complementAmount) * 100), ordered * 700);
  });
}
