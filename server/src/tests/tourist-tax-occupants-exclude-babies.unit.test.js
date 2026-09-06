// specs/tourist-tax-matches-the-office-calculation.md rule 8 — a baby is not an occupant for the
// divisor.
//
// The engine divided the nightly cost by `adults + children + teens + babies`, and dividing by more
// occupants LOWERS the tax. The office's own form was filed with 4 occupants on a stay where the
// engine counted 5 (3 adults, 1 child, 1 baby), so every stay with a cot was billed short. The cot is
// still sold — this is the divisor, not the sale.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote, computeTouristTaxBreakdown } = require('../utils/pricing').__test;

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'percentage_accommodation',
      touristTaxPercentage REAL DEFAULT 5, touristTaxDepartmentPercentage REAL DEFAULT 10, touristTaxFixedAmount REAL DEFAULT 0,
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
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura lodge')").run();
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, dateRanges)
    VALUES (1, 1, 110, '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]')`).run();
  return db;
}

// 3 nights × 110 € = 330 € TTC → 300 € HT.
const BASE = {
  propertyId: 1, startDate: '2026-05-01', endDate: '2026-05-04',
  checkInTime: '15:00', checkOutTime: '10:00', adults: 3, children: 1, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
};

test('adding a baby to a party does not change the tax', () => {
  const db = createDb();
  const withoutBaby = calculateReservationQuote({ ...BASE, db });
  const withBaby = calculateReservationQuote({ ...BASE, db, babies: 1 });

  assert.equal(withoutBaby.touristTaxOccupantsCount, 4);
  assert.equal(withBaby.touristTaxOccupantsCount, 4, 'the baby is not an occupant');
  assert.equal(withBaby.touristTaxTotal, withoutBaby.touristTaxTotal);
  db.close();
});

test('the divisor is adults + children + teens, and the caption says so', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, adults: 2, children: 1, teens: 1, babies: 2 });

  assert.equal(q.touristTaxOccupantsCount, 4);
  assert.equal(q.touristTaxPricePerNightHt, 100);          // 330 ÷ 3 ÷ 1,10
  assert.equal(q.touristTaxPerOccupantNightPriceHt, 25);   // 100 ÷ 4
  assert.equal(q.touristTaxUnitAmount, 1.38);              // 1,25 + 0,13
  assert.equal(q.touristTaxTotal, 8.28);                   // × 3 nuits × 2 adultes
  assert.match(q.touristTaxLabel, /÷ 4 occupants/);
  db.close();
});

// The Carpier declaration of August 2026: 3 adults, 1 child, 1 baby, filed with 4 occupants.
// specs/tourist-tax-matches-the-office-calculation.md rule 9 — the taxable-person count is unchanged:
// the adults pay, whoever else shares the night. Only the divisor moved.
test('a party of adults-only is unaffected — the rule only removes babies', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, adults: 4, children: 0, teens: 0, babies: 0 });
  assert.equal(q.touristTaxOccupantsCount, 4);
  db.close();
});

// The breakdown helper keeps taking the divisor it is given: the caller resolves rule 8, so a frozen
// stay can be replayed with the divisor it was frozen with (rule 12).
test('computeTouristTaxBreakdown divides by the occupants it is handed', () => {
  const withFive = computeTouristTaxBreakdown({
    touristTaxMode: 'percentage_accommodation', touristTaxPercentage: 5, touristTaxDepartmentPercentage: 10,
    nights: 3, adults: 2, occupants: 5, accommodationAmountTtc: 330, accommodationVatRate: 10,
  });
  const withFour = computeTouristTaxBreakdown({
    touristTaxMode: 'percentage_accommodation', touristTaxPercentage: 5, touristTaxDepartmentPercentage: 10,
    nights: 3, adults: 2, occupants: 4, accommodationAmountTtc: 330, accommodationVatRate: 10,
  });
  assert.equal(withFive.touristTaxPerOccupantNightPriceHt, 20);
  assert.equal(withFour.touristTaxPerOccupantNightPriceHt, 25);
  assert.ok(withFour.touristTaxTotal > withFive.touristTaxTotal, 'fewer occupants → more tax');
});

test('a cot is still billed — the baby leaves the divisor, not the sale', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, babies: 1, babyBeds: 1 });
  // The cot supplement lives in its own spec (baby-bed-supplement.md); what matters here is that the
  // divisor ignored the baby while the taxable-person count stayed the adults.
  assert.equal(q.touristTaxOccupantsCount, 4);
  assert.equal(q.touristTaxAdultsCount, 3);
  db.close();
});
