const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/tariff-recipes/spec.md §3.2 rule 12ter — THE BACKFILL.
//
// Freezing the tariff at creation only protects reservations created afterwards. Every booking
// already sold — 44 of them on the real database, i.e. all of them — would still have been
// re-priced by the next save after a recipe change. This pins the one-shot migration that stamps
// them, and proves the stamp is exact rather than a guess.

// The migration block, lifted from database.js so it can run against a fixture. Kept verbatim in
// shape: if the two ever diverge, the assertions below stop describing production.
function runBackfill(db) {
  const sold = db.prepare(`
    SELECT r.id,
           COALESCE(p.basePriceIncludedGuests, 0) AS includedGuests,
           COALESCE(p.extraGuestPrice, 0)         AS extraGuestPrice,
           COALESCE(p.extraGuestPriceUnit, 'per_stay') AS extraGuestPriceUnit
    FROM reservations r JOIN properties p ON p.id = r.propertyId
  `).all();
  const stamp = db.prepare('UPDATE reservations SET tariffSnapshot = ? WHERE id = ?');
  db.transaction(() => {
    for (const row of sold) {
      stamp.run(JSON.stringify({
        includedGuests: Number(row.includedGuests),
        extraGuestPrice: Number(row.extraGuestPrice),
        extraGuestPriceUnit: row.extraGuestPriceUnit === 'per_night' ? 'per_night' : 'per_stay',
        extraGuestTiers: null,
        freeUnitsByOption: {},
      }), row.id);
    }
  })();
  return sold.length;
}

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '16:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 2, extraGuestPrice REAL DEFAULT 27, extraGuestPriceUnit TEXT DEFAULT 'per_night');
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, propertyId INTEGER, startDate TEXT, endDate TEXT,
      adults INTEGER, tariffSnapshot TEXT DEFAULT NULL);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 200,
      pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]',
      color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1, maxNights INTEGER,
      extraGuestPrice REAL, extraGuestTiers TEXT);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT, showsPlanningCard INTEGER DEFAULT 0, cardRepeat TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL DEFAULT 0,
      freeUnits REAL NOT NULL DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0,
      priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Aventura Lodge')").run();
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, dateRanges)
    VALUES (1, 1, 200, '[{"startDate":"2026-01-01","endDate":"2027-12-31"}]')`).run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (6, 'Petit déjeuner', 'per_person_per_night', 10)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 6)').run();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, 6, 10, 0)').run();
  // Three bookings sold under the pre-recipe tariff.
  db.prepare("INSERT INTO reservations (id, propertyId, startDate, endDate, adults) VALUES (1, 1, '2026-09-10', '2026-09-12', 5), (2, 1, '2026-10-01', '2026-10-02', 3), (3, 1, '2027-04-01', '2027-04-04', 2)").run();
  return db;
}

const BASE = {
  propertyId: 1, checkInTime: '16:00', checkOutTime: '10:00', children: 0, teens: 0, babies: 0,
  customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '', platform: 'direct',
};

// Applying the recipe, exactly as the configure script does — AFTER the migration has run.
function applyNewRecipe(db) {
  db.prepare("UPDATE pricing_rules SET extraGuestTiers = ? WHERE propertyId = 1")
    .run(JSON.stringify([{ fromNight: 1, price: 15 }, { fromNight: 2, price: 8 }]));
  db.prepare('UPDATE properties SET extraGuestPrice = 15 WHERE id = 1').run();
  db.prepare('UPDATE property_option_prices SET freeUnits = 2 WHERE propertyId = 1 AND optionId = 6').run();
}

test('the backfill stamps every reservation already in the database', () => {
  const db = createDb();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservations WHERE tariffSnapshot IS NULL').get().n, 3);
  assert.equal(runBackfill(db), 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservations WHERE tariffSnapshot IS NULL').get().n, 0);
  db.close();
});

test('the stamp is the tariff in force at upgrade time, which is the sold one', () => {
  const db = createDb();
  runBackfill(db);
  const snapshot = JSON.parse(db.prepare('SELECT tariffSnapshot FROM reservations WHERE id = 1').get().tariffSnapshot);
  assert.deepEqual(snapshot, {
    includedGuests: 2,
    extraGuestPrice: 27,
    extraGuestPriceUnit: 'per_night',
    // Both provably absent for an existing reservation: the two columns are created by this same
    // migration, with NULL and 0.
    extraGuestTiers: null,
    freeUnitsByOption: {},
  });
  db.close();
});

test('a reservation sold BEFORE the upgrade keeps its price when the recipe lands', () => {
  const db = createDb();
  runBackfill(db);
  applyNewRecipe(db);

  const snapshot = JSON.parse(db.prepare('SELECT tariffSnapshot FROM reservations WHERE id = 1').get().tariffSnapshot);
  const replayed = calculateReservationQuote({
    ...BASE, db, adults: 5, startDate: '2026-09-10', endDate: '2026-09-12',
    selectedOptions: [{ optionId: 6, quantity: 1 }], lockedTariff: snapshot,
  });
  assert.equal(replayed.extraGuestSurcharge, 162, '3 extra × 27 € × 2 nuits — the sold tariff');
  assert.equal(replayed.optionLines.find((l) => l.optionId === 6).freeUnits, 0, 'the pack was not part of the deal');
  assert.equal(replayed.optionLines.find((l) => l.optionId === 6).totalPrice, 100, '10 breakfasts, all billed');

  // …and without the stamp, this is what would have happened instead.
  const unprotected = calculateReservationQuote({
    ...BASE, db, adults: 5, startDate: '2026-09-10', endDate: '2026-09-12',
    selectedOptions: [{ optionId: 6, quantity: 1 }],
  });
  assert.equal(unprotected.extraGuestSurcharge, 69);
  assert.equal(unprotected.optionLines.find((l) => l.optionId === 6).totalPrice, 80);
  db.close();
});

test('the backfill is idempotent in effect — re-running it changes nothing', () => {
  const db = createDb();
  runBackfill(db);
  const before = db.prepare('SELECT id, tariffSnapshot FROM reservations ORDER BY id').all();
  runBackfill(db);
  assert.deepEqual(db.prepare('SELECT id, tariffSnapshot FROM reservations ORDER BY id').all(), before);
  db.close();
});

test('the shipped migration and this fixture stamp the same shape', () => {
  // The backfill above is a copy; if database.js drifts, these assertions stop describing prod.
  const source = fs.readFileSync(path.join(__dirname, '..', 'database.js'), 'utf8');
  for (const key of ['includedGuests', 'extraGuestPrice', 'extraGuestPriceUnit', 'extraGuestTiers', 'freeUnitsByOption']) {
    assert.ok(source.includes(key), `the migration must still stamp ${key}`);
  }
  assert.ok(
    source.includes("db.exec('ALTER TABLE reservations ADD COLUMN tariffSnapshot TEXT DEFAULT NULL')"),
    'and must still be guarded by the column creation, so it runs exactly once',
  );
});
