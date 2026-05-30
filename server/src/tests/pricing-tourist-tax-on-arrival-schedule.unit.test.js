const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// When the owner collects the tourist tax on a non-direct platform (toggle OFF in the property's
// iCal source, i.e. `collectsTouristTax = 0`), the tax is collected at check-in. Consequence on the
// engine's payment schedule:
//   - acompte + solde are derived from `finalPrice` (stay excl. tax).
//   - the tax lives in the `complementAmount` bucket — visible from save 1, not gated on
//     deposit/balance being paid.
//   - totalStayPrice still equals finalPrice + tax.
// Direct bookings are NOT changed: the tax stays baked into the balance (legacy behaviour).
// Spec: per-platform-tourist-tax-collection.md (rule "tax collected on arrival").

function createDb({ collectsTouristTax } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 1.20, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0
    );
    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard',
      pricePerNight REAL NOT NULL DEFAULT 100, pricingMode TEXT NOT NULL DEFAULT 'fixed',
      progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1
    );
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRateAccommodation REAL, vatRateStandard REAL);
    CREATE TABLE ical_sources (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL,
      platformKey TEXT NOT NULL, collectsTouristTax INTEGER NOT NULL DEFAULT 1
    );
  `);
  db.prepare('INSERT INTO app_settings (id, vatRateAccommodation, vatRateStandard) VALUES (1, 10, 20)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Tente')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  if (collectsTouristTax !== undefined) {
    db.prepare('INSERT INTO ical_sources (id, propertyId, platformKey, collectsTouristTax) VALUES (1, 1, ?, ?)')
      .run('airbnb', collectsTouristTax ? 1 : 0);
  }
  return db;
}

// 2 nights × 2 adults × 1.20€ = 4.80€ tax. 2 nights × 100€ = 200€ stay. depositPercent = 30.
const BASE_INPUTS = {
  propertyId: 1,
  startDate: '2026-07-10',
  endDate: '2026-07-12',
  checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [],
  discountPercent: 0, customPrice: '',
  depositPaid: false, balancePaid: false,
};

test('non-direct owner-collect → tax goes to complement; acompte + solde based on finalPrice', () => {
  const db = createDb({ collectsTouristTax: false });
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, platform: 'airbnb' });

  assert.equal(q.touristTaxOfferedByPlatform, false);
  assert.equal(q.touristTaxCollectedOnArrival, true);
  assert.equal(q.finalPrice, 200);
  assert.equal(q.touristTaxTotal, 4.80);
  assert.equal(q.totalStayPrice, 204.80);

  // Schedule: 30% of 200 = 60 acompte, 140 solde, 4.80 complement (= the tax).
  assert.equal(q.depositAmount, 60);
  assert.equal(q.balanceAmount, 140);
  assert.equal(q.complementAmount, 4.80);
  // Sanity: deposit + balance + complement = totalStayPrice.
  assert.equal(q.depositAmount + q.balanceAmount + q.complementAmount, q.totalStayPrice);
  db.close();
});

test('direct booking is UNCHANGED → tax stays in balance, complement = 0', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, platform: 'direct' });

  assert.equal(q.touristTaxOfferedByPlatform, false);
  assert.equal(q.touristTaxCollectedOnArrival, false);
  assert.equal(q.touristTaxTotal, 4.80);
  assert.equal(q.totalStayPrice, 204.80);
  // Schedule: 30% of 204.80 = 61.44 acompte, 143.36 solde, 0 complement.
  assert.equal(q.depositAmount, 61.44);
  assert.equal(q.balanceAmount, 143.36);
  assert.equal(q.complementAmount, 0);
  db.close();
});

test('non-direct platform-collect → tax = 0, schedule mirrors a tax-free booking, complement = 0', () => {
  const db = createDb({ collectsTouristTax: true });
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, platform: 'airbnb' });

  assert.equal(q.touristTaxOfferedByPlatform, true);
  assert.equal(q.touristTaxCollectedOnArrival, false);
  assert.equal(q.touristTaxTotal, 0);
  assert.equal(q.totalStayPrice, 200);
  assert.equal(q.depositAmount, 60);
  assert.equal(q.balanceAmount, 140);
  assert.equal(q.complementAmount, 0);
  db.close();
});

test('non-direct owner-collect with depositPaid → balance recomputes against finalPrice, not totalStayPrice', () => {
  const db = createDb({ collectsTouristTax: false });
  const q = calculateReservationQuote({
    ...BASE_INPUTS,
    db,
    platform: 'airbnb',
    depositPaid: true,
    depositAmount: 60, // frozen at the saved acompte (= 30% of 200)
  });

  assert.equal(q.depositAmount, 60);
  // Balance must close out the pre-arrival amount only — 200 - 60 = 140 — not 204.80 - 60.
  assert.equal(q.balanceAmount, 140);
  assert.equal(q.complementAmount, 4.80);
  db.close();
});

test('non-direct owner-collect with complementPaid → complement frozen to stored value', () => {
  const db = createDb({ collectsTouristTax: false });
  const q = calculateReservationQuote({
    ...BASE_INPUTS,
    db,
    platform: 'airbnb',
    depositPaid: true,
    balancePaid: true,
    depositAmount: 60,
    balanceAmount: 140,
    complementPaid: true,
    complementAmount: 4.80,
  });

  assert.equal(q.depositAmount, 60);
  assert.equal(q.balanceAmount, 140);
  assert.equal(q.complementAmount, 4.80);
  db.close();
});
