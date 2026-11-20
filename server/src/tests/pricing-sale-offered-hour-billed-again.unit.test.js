// specs/pricing-components.md §3 rules 74, 93 (end-review verification V-2) — an hourly line a sale reads frozen keeps the hours it billed, but an offered
// line is stored at 0 €: billing it again bills its hours again, never 0 h read from its stored total. A free hour (the lodging's free minutes) stays free
// when it is offered and billed again.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const { skipWithout } = require('../plugins/sdk/testing');
const { liveHourlyResources } = require('./hourlyResourcesFixture');

liveHourlyResources();
const SKIP = { skip: skipWithout(['hourly-resources']) };

const PROPERTY = 9613;
db.prepare(`INSERT INTO properties (id, name, maxGuests, depositEnabled, touristTaxMode, touristTaxPerDayPerPerson, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit)
  VALUES (?, 'Bain', 4, 0, 'per_day_per_person', 0, 2, 0, 'per_stay')`).run(PROPERTY);
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9613, 'Sam', 'Bain')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, minNights) VALUES (?, 'Standard', 100, 1)").run(PROPERTY);
const BATH = Number(db.prepare("INSERT INTO resources (name, priceType, price) VALUES ('Bain nordique', 'per_hour', 30)").run().lastInsertRowid);
db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (?, ?)').run(BATH, PROPERTY);
db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (?, ?, 30, 60)').run(PROPERTY, BATH);

const START = addDaysToIsoDate(todayIso(), 10);
const END = addDaysToIsoDate(START, 2);

// The stay of the end review (prod stay 22336): its free hour stored as 1 billed unit at 0 €.
function stayWithFreeHour() {
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, touristTaxRate, touristTaxTotal,
      depositAmount, balanceAmount, kind, checkInTime, checkOutTime, balanceDueDate)
    VALUES (?, 9613, ?, ?, 'direct', 2, 200, 200, 0, 0, 0, 200, 'reservation', '15:00', '10:00', ?)`).run(PROPERTY, START, END, START).lastInsertRowid);
  for (let n = 0; n < 2; n += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Standard', 'fixed', 100)").run(id, addDaysToIsoDate(START, n));
  }
  db.prepare("INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement) VALUES (?, ?, 1, 30, 1, 'per_hour', 0, 0, 0)").run(id, BATH);
  return id;
}
const lines = (id) => db.prepare('SELECT lineId, totalPrice, offered FROM reservation_resources WHERE reservationId = ? ORDER BY lineId').all(id)
  .map((l) => [l.totalPrice, l.offered]);
const finalPrice = (id) => db.prepare('SELECT finalPrice FROM reservations WHERE id = ?').get(id).finalPrice;
const lastRef = (id) => `resource:${db.prepare('SELECT MAX(lineId) AS lineId FROM reservation_resources WHERE reservationId = ?').get(id).lineId}`;

test('V-2 — an hour sold at 30 €, offered, then billed again is billed 30 € again', SKIP, () => {
  const id = stayWithFreeHour();
  const quoted = extraSale.quote(id, [{ articleRef: `resource:${BATH}`, quantity: 1 }]);
  assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
  assert.equal(quoted.totalCents, 3000);
  assert.equal(extraSale.sell(id, [{ articleRef: `resource:${BATH}`, quantity: 1 }], { acceptedTotalCents: 3000 }).status, 200);
  assert.deepEqual(lines(id), [[0, 0], [30, 0]]);
  const sold = finalPrice(id);
  const ref = lastRef(id);
  assert.equal(extraSale.changeLine(id, ref, { offered: true }).status, 200);
  assert.deepEqual(lines(id), [[0, 0], [0, 1]]);
  assert.equal(finalPrice(id), sold - 30);
  const back = extraSale.changeLine(id, ref, { offered: false });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.deepEqual(lines(id), [[0, 0], [30, 0]], 'the hour is billed again');
  assert.equal(finalPrice(id), sold);
});

test('V-2 — the free hour, offered then billed again, stays free; nothing moves', SKIP, () => {
  const id = stayWithFreeHour();
  const before = finalPrice(id);
  const ref = lastRef(id);
  assert.equal(extraSale.changeLine(id, ref, { offered: true }).status, 200);
  assert.equal(extraSale.changeLine(id, ref, { offered: false }).status, 200);
  assert.deepEqual(lines(id), [[0, 0]]);
  assert.equal(finalPrice(id), before);
});
