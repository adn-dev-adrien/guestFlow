// specs/pricing/pricing-components.md §3 rule 8 — a sale reads the extra guests and the tourist tax as stored: `staySale` runs
// `storedExtraGuests` / `storedTouristTax` (the records `reservations.storedExtraGuests` / `storedTouristTax` hold) in the place of
// EXTRA GUESTS and TOURIST TAX. A setting changed since the stay was priced never moves a stay a line is sold on; a stay edit
// re-prices both; a record computed on other inputs of the stay, or stating another tax than the row, is not read (the units run) — and since
// rule 93 (owner 2026-11-15) the sale still moves the stay by its line only: what the units give is a base, never written.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const controller = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');
const { backfillSaleFigures } = require('../utils/pricingStoredFiguresMigration');
const { storedSaleFiguresOfRow, saleFiguresOf, EXTRA_GUESTS_KEYS, TOURIST_TAX_KEYS } = require('../utils/pricing/storedSaleFigures');
const extraGuestsStep = require('../utils/pricing/steps/extraGuests');
const touristTaxStep = require('../utils/pricing/steps/touristTax');
const { quoteStoredReservation } = require('../utils/storedReservationQuote');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const PROPERTY = 9611;
db.prepare(`INSERT INTO properties (id, name, maxGuests, depositEnabled, touristTaxMode, touristTaxPerDayPerPerson, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit)
  VALUES (?, 'Figures', 8, 0, 'per_day_per_person', 1.5, 2, 20, 'per_stay')`).run(PROPERTY);
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9611, 'Camille', 'Figure')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, minNights) VALUES (?, 'Standard', 100, 1)").run(PROPERTY);
const wine = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Panier vin', 25, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(PROPERTY, wine);

const START = addDaysToIsoDate(todayIso(), 20);
const END = addDaysToIsoDate(START, 4);

// A stay of 3 adults (one above the 2 the rate includes), priced at 20 € the extra guest and 1.50 € the adult and night, no tariff locked.
function stay() {
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, touristTaxRate, touristTaxTotal, kind, checkInTime, balanceDueDate)
    VALUES (?, 9611, ?, ?, 'direct', 3, 400, 420, 1.5, 18, 'reservation', '15:00', ?)`).run(PROPERTY, START, END, START).lastInsertRowid);
  for (let n = 0; n < 4; n += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Standard', 'fixed', 100)").run(id, addDaysToIsoDate(START, n));
  }
  return id;
}
const rowOf = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const money = (id) => {
  const row = rowOf(id);
  return { tax: row.touristTaxTotal, finalPrice: row.finalPrice };
};
function withSettings(fn) {
  db.prepare('UPDATE properties SET touristTaxPerDayPerPerson = 3, extraGuestPrice = 50 WHERE id = ?').run(PROPERTY);
  try { return fn(); } finally {
    db.prepare('UPDATE properties SET touristTaxPerDayPerPerson = 1.5, extraGuestPrice = 20 WHERE id = ?').run(PROPERTY);
  }
}
const sellWine = (id) => {
  const sold = extraSale.sell(id, [{ articleRef: `option:${wine}`, quantity: 1 }], { source: 'fiche' });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
};

test('rule 8 — the two records hold what the units provided, each with its basis', () => {
  const id = stay();
  backfillSaleFigures(db);
  const stored = storedSaleFiguresOfRow(rowOf(id));
  assert.deepEqual(Object.keys(stored.extraGuests.figures), [...EXTRA_GUESTS_KEYS]);
  assert.deepEqual(Object.keys(stored.touristTax.figures), [...TOURIST_TAX_KEYS]);
  assert.deepEqual([...EXTRA_GUESTS_KEYS].sort(), [...extraGuestsStep.provides].sort(), 'every key EXTRA GUESTS provides');
  assert.deepEqual([...TOURIST_TAX_KEYS].sort(), [...touristTaxStep.provides].sort(), 'every key TOURIST TAX provides');
  assert.deepEqual([stored.extraGuests.figures.extraGuestSurcharge, stored.touristTax.figures.touristTaxTotal], [20, 18]);
});

test('rules 8, 93 — a sale after the tax and extra-guest settings changed keeps the stored figures, with or without records', () => {
  const recorded = stay();
  const bare = stay();
  backfillSaleFigures(db);
  db.prepare('UPDATE reservations SET storedExtraGuests = NULL, storedTouristTax = NULL WHERE id = ?').run(bare);
  withSettings(() => {
    sellWine(recorded);
    sellWine(bare);
  });
  assert.deepEqual(money(recorded), { tax: 18, finalPrice: 445 }, 'the tax and the 20 € supplement as stored, the wine added');
  assert.deepEqual(money(bare), { tax: 18, finalPrice: 445 }, 'no record: the units run on today\'s settings, yet only the wine is written (rule 93)');
});

test('rule 8 — a quote of a sale is priced on the records too', () => {
  const id = stay();
  backfillSaleFigures(db);
  withSettings(() => {
    const quoted = extraSale.quote(id, [{ articleRef: `option:${wine}`, quantity: 1 }]);
    assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
  });
  assert.deepEqual(money(id), { tax: 18, finalPrice: 420 }, 'a quote writes nothing');
});

test('rule 8 — a stay edit re-prices the extra guests and the tax, and stores the new records', () => {
  const id = stay();
  backfillSaleFigures(db);
  withSettings(() => {
    const edited = controller.performUpdate(id, { ...storedBody(id), restatePricing: true });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
  });
  assert.deepEqual(money(id), { tax: 36, finalPrice: 450 });
  const stored = storedSaleFiguresOfRow(rowOf(id));
  assert.deepEqual([stored.extraGuests.figures.extraGuestSurcharge, stored.touristTax.figures.touristTaxTotal], [50, 36]);
  sellWine(id);
  assert.deepEqual(money(id), { tax: 36, finalPrice: 475 }, 'the next sale reads the edit\'s records');
});

test('rules 8, 93 — a record computed on other inputs of the stay is not read: a party rewritten without a pricing runs the units, the stay moves by its line', () => {
  const id = stay();
  backfillSaleFigures(db);
  db.prepare('UPDATE reservations SET adults = 4 WHERE id = ?').run(id);
  sellWine(id);
  assert.deepEqual(money(id), { tax: 18, finalPrice: 445 }, 'four adults priced as a base only: the stored tax and price plus the wine');
});

test('rule 8 — a tax record stating another tax than the row is not read', () => {
  const id = stay();
  backfillSaleFigures(db);
  db.prepare('UPDATE reservations SET touristTaxTotal = 0 WHERE id = ?').run(id);
  const stored = storedSaleFiguresOfRow(rowOf(id));
  assert.equal(stored.touristTax, null);
  assert.ok(stored.extraGuests, 'the extra-guest record stays readable');
  withSettings(() => sellWine(id));
  assert.deepEqual(money(id), { tax: 0, finalPrice: 445 }, 'the unit ran on today\'s rate as a base: the stored 0 € and the wine are written (rule 93)');
});

test('rule 8 — a stay edit\'s quote carries its records under a symbol, never as a key', () => {
  const quote = quoteStoredReservation(db, rowOf(stay()));
  assert.equal(quote.error, undefined);
  const figures = saleFiguresOf(quote);
  assert.ok(figures.extraGuests && figures.touristTax);
  assert.equal(Object.keys(quote).some((key) => /stored|saleFigures/i.test(key)), false);
  assert.equal(JSON.stringify(quote).includes('basis'), false);
});
