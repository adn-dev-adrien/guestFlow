// specs/pricing-components.md rule 30 (end-review verification V-7) — a stay whose arrival complement was typed by hand keeps that figure, so money a
// gesture would move in the arrival complement lands in no bucket. Before the arrival such a sale, and any change of an arrival line (offer, discount,
// removal, a move in or out of the arrival), is refused 409 COMPLEMENT_OVERRIDDEN and writes nothing; without the hand-typed figure it goes through.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const PROPERTY = 9615;
db.prepare(`INSERT INTO properties (id, name, maxGuests, depositEnabled, touristTaxMode, touristTaxPerDayPerPerson, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit)
  VALUES (?, 'Fixé', 4, 0, 'per_day_per_person', 0, 2, 0, 'per_stay')`).run(PROPERTY);
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9615, 'Max', 'Fixé')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, minNights) VALUES (?, 'Standard', 100, 1)").run(PROPERTY);
const wine = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Panier vin', 45, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(PROPERTY, wine);

function stay({ override }) {
  const start = addDaysToIsoDate(todayIso(), 10);
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, touristTaxRate, touristTaxTotal,
      depositAmount, balanceAmount, complementAmount, complementAmountOverride, kind, checkInTime, checkOutTime, balanceDueDate)
    VALUES (?, 9615, ?, ?, 'direct', 2, 200, 200, 0, 0, 0, 180, 20, ?, 'reservation', '15:00', '10:00', ?)`).run(PROPERTY, start, addDaysToIsoDate(start, 2), override, start).lastInsertRowid);
  for (let n = 0; n < 2; n += 1) db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Standard', 'fixed', 100)").run(id, addDaysToIsoDate(start, n));
  return id;
}
const money = (id) => db.prepare('SELECT finalPrice, balanceAmount, complementAmount FROM reservations WHERE id = ?').get(id);
const sale = [{ articleRef: `option:${wine}`, quantity: 1 }];

test('V-7 — before the arrival, a sale on a hand-typed complement is refused and writes nothing', () => {
  const id = stay({ override: 20 });
  const before = money(id);
  const quoted = extraSale.quote(id, sale);
  assert.deepEqual([quoted.status, quoted.body.code], [409, 'COMPLEMENT_OVERRIDDEN']);
  const sold = extraSale.sell(id, sale);
  assert.deepEqual([sold.status, sold.body.code, sold.body.error], [409, 'COMPLEMENT_OVERRIDDEN', 'Complément d’arrivée saisi à la main : le retirer d’abord.']);
  assert.deepEqual(money(id), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ?').get(id).n, 0);
});

test('V-7 — an arrival line of such a stay is neither offered, discounted, moved nor removed', () => {
  const id = stay({ override: null });
  assert.equal(extraSale.sell(id, sale).status, 200);
  const { lineId, collectAt } = db.prepare('SELECT lineId, collectAt FROM reservation_options WHERE reservationId = ?').get(id);
  assert.equal(collectAt, 'arrival');
  db.prepare('UPDATE reservations SET complementAmountOverride = 20 WHERE id = ?').run(id);
  const before = money(id);
  for (const patch of [{ offered: true }, { discount: { amount: 5 } }, { collectAt: 'departure' }]) {
    const changed = extraSale.changeLine(id, `option:${lineId}`, patch);
    assert.deepEqual([changed.status, changed.body && changed.body.code], [409, 'COMPLEMENT_OVERRIDDEN'], JSON.stringify(patch));
  }
  const removed = extraSale.removeLine(id, `option:${lineId}`);
  assert.deepEqual([removed.status, removed.body.code], [409, 'COMPLEMENT_OVERRIDDEN']);
  assert.deepEqual(money(id), before);
});

test('V-7 — without a hand-typed complement the sale goes through and moves the complement by its line', () => {
  const id = stay({ override: null });
  const before = money(id);
  const sold = extraSale.sell(id, sale);
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.equal(money(id).finalPrice, before.finalPrice + 45);
  assert.equal(Math.round((money(id).complementAmount - before.complementAmount) * 100), 4500);
});
