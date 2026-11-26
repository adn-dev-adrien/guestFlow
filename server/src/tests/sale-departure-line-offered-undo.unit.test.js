// specs/pricing/pricing-components.md rules 20, 23, 25 and specs/sas/mid-stay-extras-on-locked-fiche.md rule 6 (end-review verification V-5) — on a started stay
// a line sold for the departure and offered by mistake can be billed again or removed: it is not a line offered at arrival. Removing a line keeps
// every other offered line offered, an automatic one the fiche's body does not name included; the lines offered at arrival stay frozen.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const extraSalesModel = require('../models/extraSalesModel');
const { arrivalLineFloors } = require('../utils/midStayExtrasWindow');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const PROPERTY = 9614;
db.prepare(`INSERT INTO properties (id, name, maxGuests, depositEnabled, touristTaxMode, touristTaxPerDayPerPerson, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit)
  VALUES (?, 'Départ', 4, 0, 'per_day_per_person', 0, 2, 0, 'per_stay')`).run(PROPERTY);
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9614, 'Lou', 'Départ')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, minNights) VALUES (?, 'Standard', 100, 1)").run(PROPERTY);
const option = (title, price) => {
  const id = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES (?, ?, 'per_stay')").run(title, price).lastInsertRowid);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(PROPERTY, id);
  return id;
};
const wine = option('Panier vin', 45);
const welcome = option('Panier d’accueil', 20);

// A stay started yesterday, checked in, with a welcome basket offered at arrival.
function startedStay() {
  const start = addDaysToIsoDate(todayIso(), -1);
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, touristTaxRate, touristTaxTotal,
      depositAmount, balanceAmount, kind, checkInTime, checkOutTime, balanceDueDate, checkInDone)
    VALUES (?, 9614, ?, ?, 'direct', 2, 300, 300, 0, 0, 0, 300, 'reservation', '15:00', '10:00', ?, 1)`).run(PROPERTY, start, addDaysToIsoDate(start, 3), start).lastInsertRowid);
  for (let n = 0; n < 3; n += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Standard', 'fixed', 100)").run(id, addDaysToIsoDate(start, n));
  }
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement) VALUES (?, ?, 1, 20, 1, 'per_stay', 0, 1, 0)").run(id, welcome);
  return id;
}
const stored = (id) => db.prepare('SELECT optionId, totalPrice, offered FROM reservation_options WHERE reservationId = ? ORDER BY optionId').all(id).map((l) => [l.optionId, l.totalPrice, l.offered]);
const finalPrice = (id) => db.prepare('SELECT finalPrice FROM reservations WHERE id = ?').get(id).finalPrice;
const wineRef = (id) => `option:${db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, wine).lineId}`;

test('V-5 — a departure line offered by mistake is billed again, then removed; the arrival line stays offered', () => {
  const id = startedStay();
  const before = finalPrice(id);
  const sold = extraSale.sell(id, [{ articleRef: `option:${wine}`, quantity: 1 }]);
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.equal(db.prepare('SELECT collectAt FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, wine).collectAt, 'departure');
  assert.equal(extraSale.changeLine(id, wineRef(id), { offered: true }).status, 200);
  assert.equal(finalPrice(id), before);
  const rebilled = extraSale.changeLine(id, wineRef(id), { offered: false });
  assert.equal(rebilled.status, 200, JSON.stringify(rebilled.body));
  assert.equal(finalPrice(id), before + 45);
  assert.equal(extraSale.changeLine(id, wineRef(id), { offered: true }).status, 200);
  const removed = extraSale.removeLine(id, wineRef(id));
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.deepEqual(stored(id), [[welcome, 0, 1]]);
  assert.equal(finalPrice(id), before);
});

test('V-5 — the line offered at arrival is still frozen; a departure line offered is not', () => {
  const floors = arrivalLineFloors('{}', [
    { optionId: welcome, totalPrice: 0, offered: 1, quantity: 1, collectAt: 'arrival' },
    { optionId: wine, totalPrice: 0, offered: 1, quantity: 1, collectAt: 'departure' },
  ]);
  assert.deepEqual(Object.keys(floors), [`opt:${welcome}`]);
  assert.equal(floors[`opt:${welcome}`].reason, 'offered');
});

test('V-5 — removing a line keeps an offered article the body does not name offered (an automatic line)', () => {
  const body = { options: [{ optionId: wine, lineId: 7 }, { optionId: welcome, lineId: 8 }], offeredOptionIds: [1, wine, welcome] };
  const removedWine = extraSalesModel.withoutLine(body, { kind: 'option', lineId: 7, row: { optionId: wine } });
  assert.deepEqual(removedWine.offeredOptionIds, [1, welcome], 'the automatic option 1 stays offered');
  const twoLines = { options: [{ optionId: wine, lineId: 7 }, { optionId: wine, lineId: 9 }], offeredOptionIds: [wine] };
  assert.deepEqual(extraSalesModel.withoutLine(twoLines, { kind: 'option', lineId: 9, row: { optionId: wine } }).offeredOptionIds, [wine], 'another line of the article is left');
});
