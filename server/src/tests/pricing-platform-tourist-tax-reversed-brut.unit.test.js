const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/platform-payment-tourist-tax-as-option.md — for a platform_reversed booking (the platform
// collects the tourist tax from the guest then reverses it to us, and WE remit it), the operator-
// entered brut already INCLUDES the tax. The engine must count that reversed tax as part of the brut
// (an option-like line already paid) instead of baking it into the accommodation AND adding it again
// as totalStayPrice — otherwise « Net perçu » over-states the payout and the « Paiement plateforme »
// reconciliation shows a permanent écart equal to the tourist tax.

function createDb(sources = []) {
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
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE platforms (
      id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL,
      collectsTouristTax INTEGER NOT NULL DEFAULT 1,
      touristTaxRemittedByPlatform INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE ical_sources (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL,
      platformKey TEXT NOT NULL, platformLabel TEXT
    );
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Tente')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  const insPlatform = db.prepare('INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES (?, ?, ?)');
  const insSource = db.prepare('INSERT INTO ical_sources (propertyId, platformKey, platformLabel) VALUES (1, ?, ?)');
  for (const s of sources) {
    const label = s.platformLabel || s.platformKey;
    insPlatform.run(label, s.collects, s.remitted);
    insSource.run(s.platformKey, label);
  }
  return db;
}

const BASE_INPUTS = {
  propertyId: 1,
  startDate: '2026-07-10',
  endDate: '2026-07-12', // 2 nights × 2 adults × 1.20 = 4.80 € tax
  checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [],
  discountPercent: 0, customPrice: '',
  depositPaid: false, balancePaid: false,
};

test('platform_reversed + brut (incl. tax): reversed tax counts as part of the brut → écart 0', () => {
  const db = createDb([{ platformKey: 'expedia', collects: 1, remitted: 0 }]); // platform_reversed
  const ACCOMMODATION = 200; // 2 nights × 100
  const TAX = 4.80;
  const BRUT = ACCOMMODATION + TAX; // 204.80 — what the guest paid the platform (tax included)
  const COMMISSION = 20;

  const q = calculateReservationQuote({
    ...BASE_INPUTS, db, platform: 'expedia',
    platformGrossAmount: BRUT, platformCommissionAmount: COMMISSION,
  });

  // Tax amount itself is unchanged (computed on the accommodation base, not on the brut).
  assert.equal(q.touristTaxTotal, TAX);
  // Accommodation no longer absorbs the tax (it's a brut line now).
  assert.equal(q.finalPrice, ACCOMMODATION);
  // Total / balance equal the brut (the tax is counted once, not twice).
  assert.equal(q.totalStayPrice, BRUT);
  assert.equal(q.preArrivalAmount, BRUT);
  assert.equal(q.balanceAmount, BRUT);
  assert.equal(q.complementAmount, 0);
  // Net perçu = brut − commission = the virement; the « Paiement plateforme » écart is 0.
  assert.equal(q.platformNetReceivedAmount, BRUT - COMMISSION); // 184.80
  const virement = BRUT - COMMISSION;
  const ecart = Math.round((q.platformNetReceivedAmount - virement) * 100) / 100;
  assert.equal(ecart, 0);
  db.close();
});

test('guard — the SAME platform_reversed booking WITHOUT a brut is unchanged (tax on top of accommodation)', () => {
  const db = createDb([{ platformKey: 'expedia', collects: 1, remitted: 0 }]);
  const q = calculateReservationQuote({ ...BASE_INPUTS, db, platform: 'expedia' });
  assert.equal(q.finalPrice, 200);
  assert.equal(q.touristTaxTotal, 4.80);
  assert.equal(q.totalStayPrice, 204.80); // tax added on top, as before
  assert.equal(q.balanceAmount, 204.80);
  assert.equal(q.platformNetReceivedAmount, null); // no commission entered → single-line summary
  db.close();
});

test('guard — platform-offered tax (case 2) with a brut: no tax, no subtraction, unchanged', () => {
  const db = createDb([{ platformKey: 'airbnb', collects: 1, remitted: 1 }]); // platform (offered)
  const BRUT = 200;
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db, platform: 'airbnb',
    platformGrossAmount: BRUT, platformCommissionAmount: 20,
  });
  assert.equal(q.touristTaxTotal, 0); // offered → zeroed
  assert.equal(q.touristTaxReversedByPlatform, false);
  assert.equal(q.finalPrice, BRUT); // accommodation = brut (no tax to remove)
  assert.equal(q.totalStayPrice, BRUT);
  assert.equal(q.platformNetReceivedAmount, BRUT - 20);
  db.close();
});

test('guard — owner-collect tax (case 3) is untouched: tax stays in the complement', () => {
  const db = createDb([{ platformKey: 'booking', collects: 0, remitted: 0 }]); // owner
  const q = calculateReservationQuote({
    ...BASE_INPUTS, db, platform: 'booking',
    platformGrossAmount: 200, platformCommissionAmount: 20,
  });
  assert.equal(q.touristTaxTotal, 4.80);
  assert.equal(q.touristTaxCollectedOnArrival, true);
  assert.equal(q.touristTaxReversedByPlatform, false);
  assert.equal(q.complementAmount, 4.80); // tax in the complement, not the brut
  assert.equal(q.finalPrice, 200);
  db.close();
});
