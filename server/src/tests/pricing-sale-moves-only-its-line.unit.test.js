// specs/pricing/pricing-components.md §3 rules 13, 30, 74, 93 (owner 2026-11-15, end review R2-1 and R2-2) — a sale, an offer, a removal or a move of a line
// moves the stay by that line only: the stay's other stored figures (price, nights, tax, balance, deposit, stay lines) never follow the engine of today,
// even on a stay stored at figures that engine no longer reproduces; the quote is what is written. A sold line is kept when its article is no longer
// offered at the lodging, and a started stay keeps taking sales; a NEW line of such an article is refused.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const PROPERTY = 9612;
db.prepare(`INSERT INTO properties (id, name, maxGuests, depositEnabled, touristTaxMode, touristTaxPerDayPerPerson, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit)
  VALUES (?, 'Drift', 8, 0, 'per_day_per_person', 1.5, 2, 20, 'per_stay')`).run(PROPERTY);
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9612, 'Alex', 'Drift')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, minNights) VALUES (?, 'Standard', 100, 1)").run(PROPERTY);
const option = (title, price) => {
  const id = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES (?, ?, 'per_stay')").run(title, price).lastInsertRowid);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(PROPERTY, id);
  return id;
};
const wine = option('Panier vin', 45);
const cleaning = option('Ménage', 80);

const START = addDaysToIsoDate(todayIso(), 20);
const END = addDaysToIsoDate(START, 4);

// A stay stored at figures today's engine does not give back: 4 nights at 100 € sold 360 € (a price agreed by hand, no lock), no tourist tax stored
// where the engine computes one, 3 adults (one extra guest the stored price does not carry), and no sale records.
function driftedStay({ start = START, end = END } = {}) {
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, touristTaxRate, touristTaxTotal,
      depositAmount, balanceAmount, kind, checkInTime, checkOutTime, balanceDueDate)
    VALUES (?, 9612, ?, ?, 'direct', 3, 360, 360, 0, 0, 0, 360, 'reservation', '15:00', '10:00', ?)`).run(PROPERTY, start, end, start).lastInsertRowid);
  for (let n = 0; n < 4; n += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Standard', 'fixed', 90)").run(id, addDaysToIsoDate(start, n));
  }
  return id;
}

const FIGURES = ['finalPrice', 'totalPrice', 'touristTaxTotal', 'touristTaxRate', 'depositAmount', 'balanceAmount', 'complementAmount', 'endOfStayComplementAmount',
  'extraGuestComplementSurcharge', 'discountPercent', 'balanceDueDate'];
const figures = (id) => {
  const row = db.prepare(`SELECT ${FIGURES.join(', ')} FROM reservations WHERE id = ?`).get(id);
  row.nights = db.prepare('SELECT date, price FROM reservation_nights WHERE reservationId = ? ORDER BY date').all(id);
  return row;
};
const moved = (before, after) => Object.keys(before).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
  .map((key) => [key, Math.round((after[key] - before[key]) * 100)]);
const request = (id) => [{ articleRef: `option:${id}`, quantity: 1 }];

test('rules 30, 93 — a sale on a drifted stay writes the stored stay plus its line, and the quote is what is written', () => {
  const id = driftedStay();
  const before = figures(id);
  const quoted = extraSale.quote(id, request(wine));
  assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
  assert.equal(quoted.totalCents, 4500);
  const sold = extraSale.sell(id, request(wine), { acceptedTotalCents: quoted.totalCents });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.equal(sold.totalCents, 4500);
  assert.deepEqual(moved(before, figures(id)), [['finalPrice', 4500], ['complementAmount', 4500]],
    'the line and nothing else: no tax, no extra guest, no nights, no balance');
  assert.deepEqual(quoted.buckets, { plan: 0, arrival: 4500, departure: 0 }, 'the quote announces the bucket the write fills');
});

test('rule 93 — offering, discounting and removing a line move the stay by that line only', () => {
  const id = driftedStay();
  assert.equal(extraSale.sell(id, request(wine)).status, 200);
  const ref = `option:${db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, wine).lineId}`;
  let before = figures(id);
  const offered = extraSale.changeLine(id, ref, { offered: true });
  assert.equal(offered.status, 200, JSON.stringify(offered.body));
  assert.deepEqual(moved(before, figures(id)), [['finalPrice', -4500], ['complementAmount', -4500]]);
  assert.equal(extraSale.changeLine(id, ref, { offered: false }).status, 200);
  before = figures(id);
  const removed = extraSale.removeLine(id, ref);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.deepEqual(moved(before, figures(id)), [['finalPrice', -4500], ['complementAmount', -4500]]);
  assert.deepEqual(figures(id), { ...figures(id), finalPrice: 360, touristTaxTotal: 0, balanceAmount: 360 }, 'back to the stored stay');
});

test('rules 13, 74 — a sold line whose article the lodging no longer offers is kept by the next sale; a new line of it is refused', () => {
  const id = driftedStay();
  assert.equal(extraSale.sell(id, request(cleaning)).status, 200);
  db.prepare('DELETE FROM property_options WHERE propertyId = ? AND optionId = ?').run(PROPERTY, cleaning);
  try {
    const before = figures(id);
    const sold = extraSale.sell(id, request(wine));
    assert.equal(sold.status, 200, JSON.stringify(sold.body));
    assert.deepEqual(db.prepare('SELECT optionId, totalPrice FROM reservation_options WHERE reservationId = ? ORDER BY lineId').all(id),
      [{ optionId: cleaning, totalPrice: 80 }, { optionId: wine, totalPrice: 45 }], 'the cleaning line stays at its price');
    assert.deepEqual(moved(before, figures(id)), [['finalPrice', 4500], ['complementAmount', 4500]]);
    const again = extraSale.sell(id, request(cleaning));
    assert.equal(again.status, 400);
    assert.equal(again.body.code, 'ARTICLE_NOT_OFFERED');
  } finally {
    db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(PROPERTY, cleaning);
  }
});

test('rules 13, 74 — on a started stay an unlinked article\'s line and an hourly line sold before its free hour existed are kept, and the sale goes through', () => {
  const start = addDaysToIsoDate(todayIso(), -1);
  const id = driftedStay({ start, end: addDaysToIsoDate(start, 4) });
  const bath = Number(db.prepare("INSERT INTO resources (name, priceType, price) VALUES ('Bain', 'per_hour', 30)").run().lastInsertRowid);
  db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (?, ?)').run(bath, PROPERTY);
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement) VALUES (?, ?, 1, 80, 1, 'per_stay', 80, 0, 0)").run(id, cleaning);
  db.prepare("INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement) VALUES (?, ?, 1, 50, 1, 'per_hour', 50, 0, 0)").run(id, bath);
  db.prepare('UPDATE reservations SET finalPrice = 490, balanceAmount = 490, checkInDone = 1 WHERE id = ?').run(id);
  // Since the stay was sold: the cleaning is no longer offered at the lodging, and the bath's first hour is free there.
  db.prepare('DELETE FROM property_options WHERE propertyId = ? AND optionId = ?').run(PROPERTY, cleaning);
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (?, ?, 30, 60)').run(PROPERTY, bath);
  try {
    const before = figures(id);
    const sold = extraSale.sell(id, request(wine));
    assert.equal(sold.status, 200, JSON.stringify(sold.body));
    assert.deepEqual(db.prepare('SELECT optionId, totalPrice FROM reservation_options WHERE reservationId = ? ORDER BY lineId').all(id).map((l) => l.totalPrice), [80, 45]);
    assert.deepEqual(db.prepare('SELECT totalPrice FROM reservation_resources WHERE reservationId = ?').all(id), [{ totalPrice: 50 }], 'the hour keeps its 50 €');
    assert.deepEqual(moved(before, figures(id)), [['finalPrice', 4500], ['endOfStayComplementAmount', 4500]]);
  } finally {
    db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(PROPERTY, cleaning);
  }
});
