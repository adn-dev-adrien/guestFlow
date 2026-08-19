const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote, computePercentOfStayAmount } = require('../utils/pricing');

// specs/cancellation-insurance.md §3.1 — the generic `percent_of_stay` price type. `options.price`
// holds a PERCENTAGE and the assiette is the ACCOMMODATION only: the nights actually charged (after
// a discount or a manual override) plus the extra-guest surcharge. Options, resources and the taxe
// de séjour are excluded — including the insurance itself, so it can never insure its own premium.

function createDb({
  percent = 4, includedGuests = 0, extraGuestPrice = 0, extraGuestPriceUnit = 'per_stay',
  propertyPercent = null,
} = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '16:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay');
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 100,
      pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]',
      color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1, maxNights INTEGER);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT,
      showsPlanningCard INTEGER DEFAULT 0, cardRepeat TEXT, isCancellationInsurance INTEGER DEFAULT 0);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL DEFAULT 0,
      freeUnits REAL NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE resource_properties (propertyId INTEGER, resourceId INTEGER, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare(`INSERT INTO properties (id, name, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit)
    VALUES (1, 'Aventura Lodge', ?, ?, ?)`).run(includedGuests, extraGuestPrice, extraGuestPriceUnit);
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, dateRanges)
    VALUES (1, 1, 100, '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]')`).run();
  // 10 = the insurance ; 20 = an ordinary option, present to prove it stays out of the assiette.
  db.prepare(`INSERT INTO options (id, title, priceType, price, isCancellationInsurance)
    VALUES (10, 'Assurance annulation', 'percent_of_stay', ?, 1)`).run(percent);
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (20, 'Ménage', 'per_stay', 80)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10)').run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 20)').run();
  if (propertyPercent != null) {
    db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price) VALUES (1, 10, ?)').run(propertyPercent);
  }
  return db;
}

const BASE = {
  propertyId: 1, adults: 2, children: 0, teens: 0, babies: 0,
  checkInTime: '16:00', checkOutTime: '10:00',
  startDate: '2026-05-01', endDate: '2026-05-04', // 3 nights × 100 €
  customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  selectedOptions: [{ optionId: 10, quantity: 1 }],
};
const insurance = (q) => q.optionLines.find((l) => l.optionId === 10);

test('the helper clamps the percentage and refuses a non-positive base', () => {
  assert.equal(computePercentOfStayAmount(4, 960), 38.4);
  assert.equal(computePercentOfStayAmount(0, 960), 0);
  assert.equal(computePercentOfStayAmount(4, 0), 0);
  assert.equal(computePercentOfStayAmount(-5, 960), 0, 'a negative percentage never credits the guest');
  assert.equal(computePercentOfStayAmount(150, 100), 100, 'a corrupt row can never bill more than the stay');
  assert.equal(computePercentOfStayAmount('4', '960'), 38.4, 'numeric strings from the DB are accepted');
});

test('4 % of a 300 € stay is billed as one 12 € line', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db });
  const line = insurance(q);
  assert.equal(q.cancellationInsuranceBase, 300);
  assert.equal(line.unitPrice, 12);
  assert.equal(line.quantity, 1);
  assert.equal(line.billedUnits, 1);
  assert.equal(line.totalPrice, 12);
  assert.equal(line.priceType, 'percent_of_stay');
  db.close();
});

test('the assiette excludes the other options — the insurance never insures the ménage', () => {
  const db = createDb();
  const withMenage = calculateReservationQuote({
    ...BASE, db, selectedOptions: [{ optionId: 10, quantity: 1 }, { optionId: 20, quantity: 1 }],
  });
  assert.equal(withMenage.cancellationInsuranceBase, 300, '80 € of ménage stay out of the assiette');
  assert.equal(insurance(withMenage).totalPrice, 12);
  assert.equal(withMenage.optionsTotal, 92, '12 € insurance + 80 € ménage');
  db.close();
});

test('the extra-guest surcharge IS part of the assiette — it is a supplement on the nights', () => {
  const db = createDb({ includedGuests: 2, extraGuestPrice: 25, extraGuestPriceUnit: 'per_night' });
  const q = calculateReservationQuote({ ...BASE, db, adults: 3 });
  assert.equal(q.extraGuestSurcharge, 75, '1 extra guest × 3 nights × 25 €');
  assert.equal(q.cancellationInsuranceBase, 375);
  assert.equal(insurance(q).totalPrice, 15);
  db.close();
});

test('a discount lowers the premium; a manual accommodation price replaces the assiette', () => {
  const db = createDb();
  const discounted = calculateReservationQuote({ ...BASE, db, discountPercent: 10 });
  assert.equal(discounted.cancellationInsuranceBase, 270);
  assert.equal(insurance(discounted).totalPrice, 10.8);

  const overridden = calculateReservationQuote({ ...BASE, db, customPrice: 500 });
  assert.equal(overridden.cancellationInsuranceBase, 500);
  assert.equal(insurance(overridden).totalPrice, 20);
  db.close();
});

test('a platform brut never feeds the assiette — the back-solve would be circular', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, db, platform: 'Airbnb', platformGrossAmount: 900,
  });
  assert.equal(q.cancellationInsuranceBase, 300, 'the engine tariff, not the pinned brut');
  assert.equal(insurance(q).totalPrice, 12);
  db.close();
});

test('the quantity is forced to 1 — insuring the same stay twice is meaningless', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, selectedOptions: [{ optionId: 10, quantity: 5 }] });
  const line = insurance(q);
  assert.equal(line.quantity, 1);
  assert.equal(line.billedUnits, 1);
  assert.equal(line.totalPrice, 12);

  const notTaken = calculateReservationQuote({ ...BASE, db, selectedOptions: [{ optionId: 10, quantity: 0 }] });
  assert.equal(insurance(notTaken), undefined, 'quantity 0 = not taken, no line at all');
  db.close();
});

test('a per-property percentage wins over the base one', () => {
  const db = createDb({ percent: 4, propertyPercent: 6 });
  const q = calculateReservationQuote({ ...BASE, db });
  assert.equal(insurance(q).totalPrice, 18, '6 % of 300 €');
  db.close();
});

test('a sold line stays frozen when the stay is re-priced', () => {
  const db = createDb();
  // Sold at 12 € on a 300 € stay, then the nights are re-priced to 500 €: the agreed premium holds.
  const q = calculateReservationQuote({
    ...BASE, db, customPrice: 500,
    lockedOptionLines: [{ optionId: 10, quantity: 1, billedUnits: 1, unitPrice: 12, totalPrice: 12 }],
  });
  assert.equal(insurance(q).totalPrice, 12, 'no automatic re-billing of an insurance already agreed');
  db.close();
});

test('« offert » zeroes the line and keeps the real amount for a lossless un-offering', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, offeredOptionIds: [10] });
  const line = insurance(q);
  assert.equal(line.offered, true);
  assert.equal(line.totalPrice, 0);
  assert.equal(line.originalTotalPrice, 12);
  db.close();
});

test('a free stay produces a 0 € premium rather than a crash', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, customPrice: 0 });
  assert.equal(q.cancellationInsuranceBase, 0);
  assert.equal(insurance(q).totalPrice, 0);
  db.close();
});

test('a percentage option also flagged « carte planning » is still priced from the stay', () => {
  const db = createDb();
  db.prepare('UPDATE options SET showsPlanningCard = 1 WHERE id = 10').run();
  const q = calculateReservationQuote({ ...BASE, db });
  assert.equal(insurance(q).totalPrice, 12, 'the percentage is never read as a euro unit price');
  db.close();
});
