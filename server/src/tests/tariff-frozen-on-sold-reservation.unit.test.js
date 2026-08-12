const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

// specs/tariff-recipes/spec.md §3.2 rule 12bis — A RESERVATION IS PRICED BY THE TARIFF IT WAS SOLD
// UNDER. Changing a recipe must never re-price what is already in the database, even when the
// reservation is opened and saved again.
//
// The nights and the option lines were already frozen (per date, per line). The property-level
// tariff was NOT: the extra-guest supplement and the included units were recomputed from the live
// recipe on every save, so applying the 15/8 tiers silently re-priced every reservation sold at
// 27 €. `lockedTariff` is that missing half.

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '16:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 2, extraGuestPrice REAL DEFAULT 27, extraGuestPriceUnit TEXT DEFAULT 'per_night');
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
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, 6, 10, 2)').run();
  return db;
}

const BASE = {
  propertyId: 1, checkInTime: '16:00', checkOutTime: '10:00', children: 0, teens: 0, babies: 0,
  customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '', platform: 'direct',
  startDate: '2026-09-10', endDate: '2026-09-12', adults: 5,
};

// Move the tariff underneath a sold reservation, exactly as applying a new recipe would.
function moveTariffTo15And8(db) {
  db.prepare("UPDATE pricing_rules SET extraGuestTiers = ? WHERE propertyId = 1")
    .run(JSON.stringify([{ fromNight: 1, price: 15 }, { fromNight: 2, price: 8 }]));
  db.prepare('UPDATE properties SET extraGuestPrice = 15 WHERE id = 1').run();
  db.prepare('UPDATE property_option_prices SET freeUnits = 4 WHERE propertyId = 1 AND optionId = 6').run();
}

test('the quote hands back the tariff context it used, ready to be stored', () => {
  const db = createDb();
  const sold = calculateReservationQuote({ ...BASE, db, selectedOptions: [{ optionId: 6, quantity: 1 }] });
  assert.deepEqual(sold.tariffSnapshot, {
    includedGuests: 2,
    extraGuestPrice: 27,
    extraGuestPriceUnit: 'per_night',
    extraGuestTiers: null,
    freeUnitsByOption: { 6: 2 },
  });
  db.close();
});

test('editing a sold reservation replays its supplement, not the new recipe', () => {
  const db = createDb();
  const sold = calculateReservationQuote({ ...BASE, db, selectedOptions: [] });
  assert.equal(sold.extraGuestSurcharge, 162, '3 extra × 27 € × 2 nuits, the tariff it was sold at');

  moveTariffTo15And8(db);

  // Same reservation re-quoted WITHOUT its snapshot — what used to happen on every save.
  const unprotected = calculateReservationQuote({ ...BASE, db, selectedOptions: [] });
  assert.equal(unprotected.extraGuestSurcharge, 69, '3 × (15 + 8) — the new recipe leaking in');

  // …and WITH it.
  const replayed = calculateReservationQuote({
    ...BASE, db, selectedOptions: [], lockedTariff: sold.tariffSnapshot,
  });
  assert.equal(replayed.extraGuestSurcharge, 162, 'the sold tariff wins');
  db.close();
});

test('the replay follows a guest-count change — it freezes the RULE, not the amount', () => {
  const db = createDb();
  const sold = calculateReservationQuote({ ...BASE, db, selectedOptions: [] });
  moveTariffTo15And8(db);

  // The operator adds a guest during the edit: the supplement must recompute, at the OLD rate.
  const withOneMore = calculateReservationQuote({
    ...BASE, db, adults: 6, selectedOptions: [], lockedTariff: sold.tariffSnapshot,
  });
  assert.equal(withOneMore.extraGuestSurcharge, 216, '4 extra × 27 € × 2 nuits');
  db.close();
});

test('included units are replayed too — a widened pack never reaches an old booking', () => {
  const db = createDb();
  const sold = calculateReservationQuote({ ...BASE, db, selectedOptions: [{ optionId: 6, quantity: 1 }] });
  const soldLine = sold.optionLines.find((l) => l.optionId === 6);
  assert.equal(soldLine.freeUnits, 2);
  assert.equal(soldLine.totalPrice, 80, '10 units, 2 covered, 8 billed at 10 €');

  moveTariffTo15And8(db); // the pack grows to 4 free units

  const replayed = calculateReservationQuote({
    ...BASE, db, selectedOptions: [{ optionId: 6, quantity: 1 }], lockedTariff: sold.tariffSnapshot,
  });
  const line = replayed.optionLines.find((l) => l.optionId === 6);
  assert.equal(line.freeUnits, 2, 'still the two it was granted');
  assert.equal(line.totalPrice, 80);
  db.close();
});

test('a NEW reservation gets the new tariff — the freeze protects the past, it does not stop the future', () => {
  const db = createDb();
  moveTariffTo15And8(db);
  const fresh = calculateReservationQuote({ ...BASE, db, selectedOptions: [{ optionId: 6, quantity: 1 }] });
  assert.equal(fresh.extraGuestSurcharge, 69);
  assert.equal(fresh.optionLines.find((l) => l.optionId === 6).freeUnits, 4);
  db.close();
});

test('no snapshot (a reservation predating the column) keeps the live behaviour', () => {
  const db = createDb();
  moveTariffTo15And8(db);
  const q = calculateReservationQuote({ ...BASE, db, selectedOptions: [], lockedTariff: null });
  assert.equal(q.extraGuestSurcharge, 69, 'no past tariff was ever recorded — inventing one would be worse');
  db.close();
});

test('the included-guest threshold is frozen as well', () => {
  const db = createDb();
  const sold = calculateReservationQuote({ ...BASE, db, selectedOptions: [] });
  db.prepare('UPDATE properties SET basePriceIncludedGuests = 4 WHERE id = 1').run();
  const replayed = calculateReservationQuote({ ...BASE, db, selectedOptions: [], lockedTariff: sold.tariffSnapshot });
  assert.equal(replayed.extraGuestCount, 3, 'still 5 guests above the 2 it was sold with');
  db.close();
});
