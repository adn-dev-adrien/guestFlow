const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/tariff-recipes/plan.md step 1 — the regression net for the whole tariff-recipes work.
// These totals are recorded against the PRE-CHANGE engine and must stay green through every
// subsequent step: they prove that a property using the legacy configuration (per-stay extra
// guest, no recipe, no net target, no changeover) prices byte-identically before and after.
//
// Deliberate coverage boundaries:
//  - the progressive season WITH provided tiers is only exercised up to its last provided tier
//    (the carry-forward of spec rule 39 changes prices beyond it, by design);
//  - the progressive season WITHOUT provided tiers is exercised beyond 14 nights (the legacy
//    weekly-model fallback must survive for unconfigured seasons).

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 30,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT,
      pricePerNight REAL DEFAULT 100, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]',
      dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  // Property 1 — fixed-mode season + legacy per-stay extra guest above 2.
  db.prepare("INSERT INTO properties (id, name, basePriceIncludedGuests, extraGuestPrice) VALUES (1, 'Gite fixe', 2, 15)").run();
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, label, pricePerNight, dateRanges)
    VALUES (1, 1, 'Annuel', 120, '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]')`).run();
  // Property 2 — progressive season WITH provided tiers up to night 5.
  db.prepare("INSERT INTO properties (id, name, basePriceIncludedGuests, extraGuestPrice) VALUES (2, 'Gite progressif', 2, 20)").run();
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges)
    VALUES (2, 2, 'Annuel', 100, 'progressive',
      '[{"nightNumber":2,"extraNightPrice":80},{"nightNumber":3,"extraNightPrice":70},{"nightNumber":4,"extraNightPrice":60},{"nightNumber":5,"extraNightPrice":50}]',
      '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]')`).run();
  // Property 3 — progressive season WITHOUT provided tiers (legacy weekly model at any length).
  db.prepare("INSERT INTO properties (id, name) VALUES (3, 'Gite hebdo')").run();
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, label, pricePerNight, pricingMode, dateRanges)
    VALUES (3, 3, 'Annuel', 100, 'progressive', '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]')`).run();
  return db;
}

const BASE = {
  checkInTime: '15:00', checkOutTime: '10:00', children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
};

test('fixed season, 2 adults, 3 nights → 360, no extra-guest line', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, propertyId: 1, startDate: '2026-05-01', endDate: '2026-05-04', adults: 2 });
  assert.equal(q.finalPrice, 360);
  assert.equal(q.extraGuestCount, 0);
  assert.equal(q.extraGuestSurcharge, 0);
  db.close();
});

test('fixed season, 4 adults, 3 nights → legacy per-stay surcharge 2 × 15 = 30, total 390', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, propertyId: 1, startDate: '2026-05-01', endDate: '2026-05-04', adults: 4 });
  assert.equal(q.extraGuestCount, 2);
  assert.equal(q.extraGuestSurcharge, 30);
  assert.equal(q.finalPrice, 390);
  db.close();
});

test('progressive with tiers, 2 adults, 5 nights (last provided tier) → 100+80+70+60+50 = 360', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, propertyId: 2, startDate: '2026-05-01', endDate: '2026-05-06', adults: 2 });
  assert.equal(q.finalPrice, 360);
  assert.deepEqual(q.nightlyBreakdown.map((n) => n.price), [100, 80, 70, 60, 50]);
  db.close();
});

test('progressive with tiers, 3 adults, 4 nights → per-stay surcharge 20, total 330', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, propertyId: 2, startDate: '2026-05-01', endDate: '2026-05-05', adults: 3 });
  assert.equal(q.extraGuestSurcharge, 20);
  assert.equal(q.finalPrice, 330); // 100+80+70+60 + 20
  db.close();
});

test('progressive without tiers, 20 nights → legacy weekly model preserved (flat 400/7 per night beyond 7)', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, propertyId: 3, startDate: '2026-05-01', endDate: '2026-05-21', adults: 2 });
  // Weekly model: weekPrice = 100 × 4 = 400. Totals per calculateStayPrice: 7 nights = 400;
  // beyond 7 the marginal night is round(n×400/7) − round((n−1)×400/7). 20 nights → round(20×400/7) = 1143.
  assert.equal(q.finalPrice, 1143);
  db.close();
});

test('progressive without tiers, 3 nights → weekly model 60% of 400 = 240', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, propertyId: 3, startDate: '2026-05-01', endDate: '2026-05-04', adults: 2 });
  assert.equal(q.finalPrice, 240);
  db.close();
});

test('deposit/balance split unchanged: fixed season 3 nights → deposit 108 (30%), balance 252', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, propertyId: 1, startDate: '2026-05-01', endDate: '2026-05-04', adults: 2 });
  assert.equal(q.depositAmount, 108);
  assert.equal(q.balanceAmount, 252);
  db.close();
});
