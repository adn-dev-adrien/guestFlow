const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote, isTouristTaxRemittedByOwner } = require('../utils/pricing').__test;

// specs/per-platform-tourist-tax-three-way.md — the per-platform tourist-tax handling is two
// orthogonal booleans on `ical_sources`:
//   collectsTouristTax           = is the tax charged to the guest BY US? (1 = offered, 0 = at arrival)
//   touristTaxRemittedByPlatform = does the PLATFORM remit it to the commune? (1 = yes, 0 = we do)
// → three valid states: platform (1,1), platform_reversed (1,0), owner (0,0). `isTouristTaxRemitted-
//   ByOwner` answers "do WE remit?" (→ Suivi + 46710000 accounting line).

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
    -- The tourist-tax mode is GLOBAL on platforms; ical_sources only bridges the hyphenated iCal
    -- platformKey to the canonical platformLabel for iCal-imported reservations.
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
    insSource.run(s.platformKey, label); // bridge so the hyphenated key also resolves
  }
  return db;
}

const BASE_INPUTS = {
  propertyId: 1,
  startDate: '2026-07-10',
  endDate: '2026-07-12', // 2 nights
  checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [],
  discountPercent: 0, customPrice: '',
  depositPaid: false, balancePaid: false,
};

// ── isTouristTaxRemittedByOwner resolver ──────────────────────────────────────────────────────

test('direct → we always remit', () => {
  const db = createDb();
  assert.equal(isTouristTaxRemittedByOwner(db, 1, 'direct'), true);
  db.close();
});

test('platform (collects + remits to commune) → we do NOT remit', () => {
  const db = createDb([{ platformKey: 'airbnb', collects: 1, remitted: 1 }]);
  assert.equal(isTouristTaxRemittedByOwner(db, 1, 'airbnb'), false);
  db.close();
});

test('platform_reversed (collects then reverses to us) → we remit', () => {
  const db = createDb([{ platformKey: 'expedia', collects: 1, remitted: 0 }]);
  assert.equal(isTouristTaxRemittedByOwner(db, 1, 'expedia'), true);
  db.close();
});

test('owner (we collect at arrival) → we remit', () => {
  const db = createDb([{ platformKey: 'booking', collects: 0, remitted: 0 }]);
  assert.equal(isTouristTaxRemittedByOwner(db, 1, 'booking'), true);
  db.close();
});

test('no matching source → default to "platform handles it" (we do NOT remit)', () => {
  const db = createDb();
  assert.equal(isTouristTaxRemittedByOwner(db, 1, 'airbnb'), false);
  db.close();
});

test('match is case-insensitive on platformKey AND platformLabel', () => {
  const db = createDb([{ platformKey: 'g-tes-de-france', platformLabel: 'GitesDeFrance', collects: 1, remitted: 0 }]);
  for (const p of ['g-tes-de-france', 'G-TES-DE-FRANCE', 'GitesDeFrance', 'gitesdefrance']) {
    assert.equal(isTouristTaxRemittedByOwner(db, 1, p), true, p);
  }
  db.close();
});

test('missing ical_sources table → defensive default (we do NOT remit, no crash)', () => {
  const db = new Database(':memory:');
  assert.equal(isTouristTaxRemittedByOwner(db, 1, 'airbnb'), false);
  db.close();
});

// ── quote.touristTaxRemittedByOwner + schedule parity ─────────────────────────────────────────

test('quote exposes touristTaxRemittedByOwner for the four cases', () => {
  const db = createDb([
    { platformKey: 'airbnb', collects: 1, remitted: 1 },   // platform
    { platformKey: 'expedia', collects: 1, remitted: 0 },  // platform_reversed
    { platformKey: 'booking', collects: 0, remitted: 0 },  // owner
  ]);
  const direct = calculateReservationQuote({ ...BASE_INPUTS, db, platform: 'direct' });
  const platform = calculateReservationQuote({ ...BASE_INPUTS, db, platform: 'airbnb' });
  const reversed = calculateReservationQuote({ ...BASE_INPUTS, db, platform: 'expedia' });
  const owner = calculateReservationQuote({ ...BASE_INPUTS, db, platform: 'booking' });

  assert.equal(direct.touristTaxRemittedByOwner, true);
  assert.equal(platform.touristTaxRemittedByOwner, false);
  assert.equal(reversed.touristTaxRemittedByOwner, true);
  assert.equal(owner.touristTaxRemittedByOwner, true);
  db.close();
});

test('platform (case 2) is OFFERED; platform_reversed (case 1) is CHARGED in the balance', () => {
  const db = createDb([
    { platformKey: 'airbnb', collects: 1, remitted: 1 },   // platform → remits to commune itself
    { platformKey: 'expedia', collects: 1, remitted: 0 },  // platform_reversed → reverses to us
  ]);
  const platform = calculateReservationQuote({ ...BASE_INPUTS, db, platform: 'airbnb' });
  const reversed = calculateReservationQuote({ ...BASE_INPUTS, db, platform: 'expedia' });

  // Case 2: OFFERED — the platform remits it to the commune; absent from our books.
  assert.equal(platform.touristTaxOfferedByPlatform, true);
  assert.equal(platform.touristTaxTotal, 0);
  assert.equal(platform.touristTaxReversedByPlatform, false);
  assert.equal(platform.totalStayPrice, platform.finalPrice); // no tax in the total

  // Case 1: CHARGED — the real tax is billed and sits in the BALANCE (the platform pays it to us with
  // the settlement). Not offered, not collected at arrival; it shows on the fiche + the « Taxe de séjour » page.
  assert.equal(reversed.touristTaxOfferedByPlatform, false);
  assert.equal(reversed.touristTaxTotal, 4.80); // 2 adults × 2 nights × 1.20
  assert.equal(reversed.touristTaxCollectedOnArrival, false);
  assert.equal(reversed.touristTaxReversedByPlatform, true);
  assert.equal(reversed.touristTaxRemittedByOwner, true);
  assert.equal(reversed.totalStayPrice, reversed.finalPrice + 4.80);
  assert.equal(reversed.balanceAmount, platform.balanceAmount + 4.80); // tax rides the balance (deposit=0 on platforms)
  assert.equal(reversed.complementAmount, 0);
  db.close();
});
