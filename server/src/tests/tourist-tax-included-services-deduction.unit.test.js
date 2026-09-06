const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/tourist-tax-included-services-deduction.md — in percentage mode the tax base is the DRY
// NIGHT: the accommodation charged, minus the reference value of the services sold inside the rate
// (property defaults marked « offerte »). That value is a per-stay forfait computed on the guests
// the rate includes, so it never moves with the size of the party.
//
// Fixture = the Lodge as configured in production: 3 nights at 119,93 € (359,79 €), tourist tax at
// 5 % + 10 % departmental, VAT 10 %, 2 guests included in the rate, and three inclusions —
// Ménage 30 €/séjour, Linge de lit 7 €/pers, Linge de toilette 8 €/pers = 60 € of deduction.

function createDb({ mode = 'percentage_accommodation', includedGuests = 2 } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay');
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT,
      pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]',
      dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT, collectsTouristTax INTEGER DEFAULT 1,
      touristTaxRemittedByPlatform INTEGER DEFAULT 1);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare(`INSERT INTO properties
      (id, name, touristTaxMode, touristTaxPercentage, touristTaxDepartmentPercentage, touristTaxPerDayPerPerson,
       basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit)
    VALUES (1, 'Aventura lodge', ?, ?, ?, ?, ?, 25, 'per_stay')`)
    .run(
      mode,
      mode === 'per_day_per_person' ? 0 : 5,
      mode === 'per_day_per_person' ? 0 : 10,
      mode === 'per_day_per_person' ? 1.2 : 0,
      includedGuests,
    );
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, dateRanges)
    VALUES (1, 1, 119.93, '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]')`).run();
  const addOption = db.prepare('INSERT INTO options (id, title, priceType, price) VALUES (?, ?, ?, ?)');
  addOption.run(7, 'Ménage', 'per_stay', 30);
  addOption.run(8, 'Linge de lit', 'per_person', 7);
  addOption.run(9, 'Linge de toilette', 'per_person', 8);
  addOption.run(11, 'Panier gourmand', 'per_stay', 45);
  const addApplicable = db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)');
  for (const id of [7, 8, 9, 11]) addApplicable.run(id);
  const addDefault = db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, ?, 1)');
  for (const id of [7, 8, 9]) addDefault.run(id);
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType) VALUES (20, 'Bain nordique', 1, 90, 'per_stay')").run();
  db.prepare("INSERT INTO platforms (id, name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES (1, 'Lodgify', 1, 0)").run();
  return db;
}

const BASE = {
  propertyId: 1, startDate: '2026-05-01', endDate: '2026-05-04',
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
};

// The three property defaults, offered — what a new Lodge booking carries.
const INCLUSIONS = {
  selectedOptions: [
    { optionId: 7, quantity: 1, offered: 1 },
    { optionId: 8, quantity: 1, offered: 1 },
    { optionId: 9, quantity: 1, offered: 1 },
  ],
  offeredOptionIds: [7, 8, 9],
};

test('the tax is computed on the dry night — 359,79 € minus the 60 € of inclusions', () => {
  const db = createDb();
  const withoutInclusions = calculateReservationQuote({ ...BASE, db });
  const withInclusions = calculateReservationQuote({ ...BASE, ...INCLUSIONS, db });

  assert.equal(withoutInclusions.touristTaxBaseAccommodation, 359.79);
  assert.equal(withoutInclusions.touristTaxTotal, 18);

  assert.equal(withInclusions.touristTaxBaseBeforeDeduction, 359.79);
  assert.equal(withInclusions.touristTaxIncludedInRateDeduction, 60);  // 30 + 7×2 + 8×2
  assert.equal(withInclusions.touristTaxBaseAccommodation, 299.79);
  assert.equal(withInclusions.touristTaxTotal, 15);
  db.close();
});

// Rule 3 — the whole point of the forfait. The former rule 48 deducted 7 €/pers and 8 €/pers on the
// REAL party, so a family of six declared a smaller base than a couple in the same night.
test('the deduction is a per-stay forfait — identical for 2 and for 6 occupants', () => {
  const db = createDb();
  const couple = calculateReservationQuote({ ...BASE, ...INCLUSIONS, db });
  const family = calculateReservationQuote({ ...BASE, ...INCLUSIONS, db, adults: 2, children: 2, teens: 2 });

  assert.equal(family.touristTaxIncludedInRateDeduction, 60);
  assert.equal(family.touristTaxBaseAccommodation, couple.touristTaxBaseAccommodation);
  // The linen lines are still SOLD for six — only the tax reference is capped at the included guests.
  assert.equal(family.optionLines.find((l) => l.optionId === 8).originalTotalPrice, 42);
  db.close();
});

test('a one-off commercial gesture is not an inclusion — offering a non-default option changes nothing', () => {
  const db = createDb();
  const reference = calculateReservationQuote({ ...BASE, ...INCLUSIONS, db });
  const withGesture = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [...INCLUSIONS.selectedOptions, { optionId: 11, quantity: 1, offered: 1 }],
    offeredOptionIds: [...INCLUSIONS.offeredOptionIds, 11],
  });

  assert.equal(withGesture.optionLines.find((l) => l.optionId === 11).includedInRate, undefined);
  assert.equal(withGesture.touristTaxIncludedInRateDeduction, 60);
  assert.equal(withGesture.touristTaxTotal, reference.touristTaxTotal);
  db.close();
});

test('a custom option offered is never deducted', () => {
  const db = createDb();
  const reference = calculateReservationQuote({ ...BASE, ...INCLUSIONS, db });
  const withCustom = calculateReservationQuote({
    ...BASE, ...INCLUSIONS, db,
    customOptions: [{ description: 'Transfert gare', amount: 80, offered: true }],
  });

  assert.equal(withCustom.touristTaxIncludedInRateDeduction, 60);
  assert.equal(withCustom.touristTaxTotal, reference.touristTaxTotal);
  db.close();
});

test('a paid extra or a resource still moves nothing', () => {
  const db = createDb();
  const reference = calculateReservationQuote({ ...BASE, ...INCLUSIONS, db });

  const withPaidOption = calculateReservationQuote({
    ...BASE, db,
    selectedOptions: [...INCLUSIONS.selectedOptions, { optionId: 11, quantity: 1 }],
    offeredOptionIds: INCLUSIONS.offeredOptionIds,
  });
  const withResource = calculateReservationQuote({
    ...BASE, ...INCLUSIONS, db, selectedResources: [{ resourceId: 20, quantity: 1 }],
  });

  assert.equal(withPaidOption.touristTaxTotal, reference.touristTaxTotal);
  assert.equal(withResource.touristTaxTotal, reference.touristTaxTotal);
  db.close();
});

// Edge case — a property where every guest is an extra: capping the reference at 0 included guests
// would make a per_person inclusion worth nothing, so the real party is used instead.
test('a property with no included guest values a per-person inclusion on the real party', () => {
  const db = createDb({ includedGuests: 0 });
  const q = calculateReservationQuote({ ...BASE, ...INCLUSIONS, db, adults: 3 });
  assert.equal(q.touristTaxIncludedInRateDeduction, 75);  // 30 + 7×3 + 8×3
  db.close();
});

test('the extra-guest surcharge stays out of the base, deduction or not', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, ...INCLUSIONS, db, adults: 4 });
  assert.equal(q.extraGuestSurcharge, 50);                  // 2 extra guests × 25 €
  assert.equal(q.touristTaxBaseAccommodation, 299.79);      // untouched by the surcharge
  db.close();
});

test('customPrice and the discount drive the accommodation BEFORE the deduction', () => {
  const db = createDb();
  const custom = calculateReservationQuote({ ...BASE, ...INCLUSIONS, db, customPrice: 300 });
  assert.equal(custom.touristTaxBaseBeforeDeduction, 300);
  assert.equal(custom.touristTaxBaseAccommodation, 240);

  const discounted = calculateReservationQuote({ ...BASE, ...INCLUSIONS, db, discountPercent: 10 });
  assert.equal(discounted.touristTaxBaseBeforeDeduction, 323.81);   // 359,79 − 10 %
  assert.equal(discounted.touristTaxBaseAccommodation, 263.81);
  db.close();
});

// Rule 6 — the half of specs/tourist-tax-base-accommodation-only.md that stays. The brut is a
// payment figure; it never derives the base, with or without inclusions on the booking.
// specs/tourist-tax-matches-the-office-calculation.md rule 2 repeals the decoupling, but rule 5
// keeps this deduction: on a platform booking the inclusions come out of the BRUT, not out of the
// tariff. The office asked for the accommodation « hors options et ménage », whoever cashed it.
test('the inclusions are deducted from the platform brut too', () => {
  const db = createDb();
  const direct = calculateReservationQuote({ ...BASE, ...INCLUSIONS, db });
  const withBrut = calculateReservationQuote({
    ...BASE, ...INCLUSIONS, db, platform: 'Lodgify', platformGrossAmount: 450,
  });

  // The brut is what the guest paid; 60 € of it bought the cleaning and the linen sold inside the
  // rate, so the dry night is 390 € — where a direct booking at the same tariff declares 299,79 €.
  assert.equal(direct.touristTaxBaseAccommodation, 299.79);
  assert.equal(withBrut.touristTaxBaseAccommodation, 390);
  assert.ok(withBrut.touristTaxTotal > direct.touristTaxTotal);
  assert.equal(withBrut.totalStayPrice, 450);
  db.close();
});

test('flat per-adult-per-night mode ignores the inclusions entirely', () => {
  const db = createDb({ mode: 'per_day_per_person' });
  const q = calculateReservationQuote({ ...BASE, ...INCLUSIONS, db });
  assert.equal(q.touristTaxTotal, 7.2);   // 1,20 € × 2 adultes × 3 nuits
  db.close();
});

test('a past stay keeps its frozen amount — the deduction does not re-price it', () => {
  const db = createDb();
  const q = calculateReservationQuote({
    ...BASE, ...INCLUSIONS, db,
    freezeTouristTax: true, frozenTouristTaxTotal: 18, frozenTouristTaxRate: 3,
  });
  assert.equal(q.touristTaxTotal, 18);
  assert.equal(q.touristTaxRate, 3);
  db.close();
});
