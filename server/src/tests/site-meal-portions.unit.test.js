// Meals counted in portions on the website (specs/site-meal-portions.md): a per-person planning-card
// option's quantity means PORTIONS — one breakfast, one cover — capped by what the stay can serve,
// clamped on the live quote and refused on the booking request. Also covers the labels, the caps the
// quote publishes, the property-default quantity and the migration of devis stored under the old
// séance meaning.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  isPerPersonCardOption, servingsFor, portionCap, clampPortions, portionWording,
} = require('../utils/mealPortions');
const { calculateReservationQuote } = require('../utils/pricing');
const { toPublicOptionLimits } = require('../utils/publicProjections');
const { mergePropertyDefaultsIntoPayload } = require('../utils/propertyDefaultOptions');
const { runMealPortionQuantitiesMigration } = require('../utils/migrateMealPortionQuantities');

const BREAKFAST = { id: 6, title: 'Petit déjeuner', priceType: 'per_person_per_night', price: 8, showsPlanningCard: 1, autoOptionType: 'breakfast' };
const TRAPPER = { id: 16, title: 'Le repas des trappeurs', priceType: 'per_person_per_night', price: 25, showsPlanningCard: 1 };
const ROOM = { id: 7, title: 'Location salle', priceType: 'per_stay', price: 45, showsPlanningCard: 1 };
const PROPERTY = { defaultCheckIn: '16:00', defaultCheckOut: '10:00' };

// ---- which options count portions (rule 1) ----

test('per-person card options count portions; per-group cards and the insurance do not', () => {
  assert.equal(isPerPersonCardOption(BREAKFAST), true);
  assert.equal(isPerPersonCardOption(TRAPPER), true);
  assert.equal(isPerPersonCardOption(ROOM), false);
  assert.equal(isPerPersonCardOption({ ...BREAKFAST, showsPlanningCard: 0 }), false);
  assert.equal(isPerPersonCardOption({ ...TRAPPER, isCancellationInsurance: 1 }), false);
});

// ---- how many servings a stay holds (rule 3) ----

test('breakfast: one serving per night', () => {
  const { servings } = servingsFor({ option: BREAKFAST, nights: 3, property: PROPERTY });
  assert.equal(servings, 3);
});

test('breakfast ignores the arrival and departure times', () => {
  const early = servingsFor({ option: BREAKFAST, nights: 3, checkInTime: '09:00', checkOutTime: '18:00', property: PROPERTY });
  assert.equal(early.servings, 3);
  assert.deepEqual(early.extras, { arrival: false, departure: false });
});

test('meals: two a day, with the property default times', () => {
  const { servings, extras } = servingsFor({ option: TRAPPER, nights: 3, property: PROPERTY });
  assert.equal(servings, 6);
  assert.deepEqual(extras, { arrival: false, departure: false });
});

test('meals: an arrival before noon adds the arrival lunch, 12:00 sharp does not', () => {
  assert.equal(servingsFor({ option: TRAPPER, nights: 3, checkInTime: '11:59', property: PROPERTY }).servings, 7);
  assert.equal(servingsFor({ option: TRAPPER, nights: 3, checkInTime: '12:00', property: PROPERTY }).servings, 6);
});

test('meals: a departure after noon adds the departure lunch, 12:00 sharp does not', () => {
  assert.equal(servingsFor({ option: TRAPPER, nights: 3, checkOutTime: '12:01', property: PROPERTY }).servings, 7);
  assert.equal(servingsFor({ option: TRAPPER, nights: 3, checkOutTime: '12:00', property: PROPERTY }).servings, 6);
});

test('meals: both ends count — 3 nights, 11:00 → 14:00 gives 8 servings', () => {
  const { servings, extras } = servingsFor({
    option: TRAPPER, nights: 3, checkInTime: '11:00', checkOutTime: '14:00', property: PROPERTY,
  });
  assert.equal(servings, 8);
  assert.deepEqual(extras, { arrival: true, departure: true });
});

test("the property's own default times decide when the visitor gives none", () => {
  const generous = { defaultCheckIn: '10:00', defaultCheckOut: '17:00' };
  assert.equal(servingsFor({ option: TRAPPER, nights: 2, property: generous }).servings, 6);
});

test('no nights → no servings, whatever the times say', () => {
  assert.equal(servingsFor({ option: TRAPPER, nights: 0, checkInTime: '09:00', property: PROPERTY }).servings, 0);
  assert.equal(servingsFor({ option: BREAKFAST, nights: 0, property: PROPERTY }).servings, 0);
});

test('the cap is persons × servings, and clamping reports what was asked', () => {
  const limit = portionCap({ option: BREAKFAST, persons: 4, nights: 3, property: PROPERTY });
  assert.equal(limit.cap, 12);
  assert.deepEqual(clampPortions(8, limit.cap), { quantity: 8, clampedFrom: null });
  assert.deepEqual(clampPortions(13, limit.cap), { quantity: 12, clampedFrom: 13 });
  assert.deepEqual(clampPortions(12, limit.cap), { quantity: 12, clampedFrom: null });
});

// ---- the engine (rules 1-3) ----

function seedDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '16:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0
    );
    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard',
      pricePerNight REAL NOT NULL DEFAULT 100, pricingMode TEXT NOT NULL DEFAULT 'fixed',
      progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1
    );
    CREATE TABLE options (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
      priceType TEXT NOT NULL DEFAULT 'per_stay', price REAL NOT NULL DEFAULT 0,
      optionProgressiveTiers TEXT NOT NULL DEFAULT '[]', autoOptionType TEXT,
      autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT NOT NULL DEFAULT 'fixed', autoFullNightThreshold TEXT,
      showsPlanningCard INTEGER NOT NULL DEFAULT 0, cardRepeat TEXT DEFAULT 'once_per_day', planningCardTimes TEXT DEFAULT '[]'
    );
    CREATE TABLE property_options ( propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId) );
    CREATE TABLE resources ( id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, price REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay', isComplex INTEGER NOT NULL DEFAULT 0, propertyIds TEXT DEFAULT '[]', showsPlanningCard INTEGER NOT NULL DEFAULT 0, slotDuration INTEGER NOT NULL DEFAULT 30, hourlyEveningStart TEXT, hourlyEveningRate REAL NOT NULL DEFAULT 0, openTime TEXT DEFAULT '12:00', closeTime TEXT DEFAULT '22:00', minimumUsageMinutes INTEGER DEFAULT 60 );
    CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
  `);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte test')").run();
  db.prepare("INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 120, 1)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price, showsPlanningCard, autoOptionType) VALUES (6, 'Petit déjeuner', 'per_person_per_night', 8, 1, 'breakfast')").run();
  db.prepare("INSERT INTO options (id, title, priceType, price, showsPlanningCard) VALUES (16, 'Le repas des trappeurs', 'per_person_per_night', 25, 1)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price, showsPlanningCard) VALUES (7, 'Location salle', 'per_stay', 45, 1)").run();
  [6, 16, 7].forEach((id) => db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(id));
  return db;
}

// 3 nights, 4 persons → breakfast cap 12, meal cap 24 at the default times.
const STAY = { propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-13', adults: 4, children: 0, teens: 0, babies: 0 };

function publicQuote(over) {
  return calculateReservationQuote({
    db: seedDb(), ...STAY, ...over, planningCardAsQuantity: true,
  });
}

test('8 breakfasts for 4 guests bill 8 portions, not 32', () => {
  const line = publicQuote({ selectedOptions: [{ optionId: 6, quantity: 8 }] })
    .optionLines.find((l) => l.optionId === 6);
  assert.equal(line.quantity, 8);
  assert.equal(line.billedUnits, 8);
  assert.equal(line.totalPrice, 64);
  assert.equal(line.clampedFrom, null);
  assert.deepEqual(line.cardOccurrences, []);
  assert.equal(line.toBeScheduled, true);
});

test('over the cap, the live quote clamps and says what was asked', () => {
  const line = publicQuote({ selectedOptions: [{ optionId: 6, quantity: 13 }] })
    .optionLines.find((l) => l.optionId === 6);
  assert.equal(line.quantity, 12); // 4 personnes × 3 matins
  assert.equal(line.billedUnits, 12);
  assert.equal(line.totalPrice, 96);
  assert.equal(line.clampedFrom, 13);
});

test('the meal cap follows the arrival and departure times', () => {
  const atDefaults = publicQuote({ selectedOptions: [{ optionId: 16, quantity: 30 }] })
    .optionLines.find((l) => l.optionId === 16);
  assert.equal(atDefaults.quantity, 24); // 4 × (2 × 3)

  const stretched = publicQuote({
    selectedOptions: [{ optionId: 16, quantity: 30 }], checkInTime: '11:00', checkOutTime: '14:00',
  }).optionLines.find((l) => l.optionId === 16);
  assert.equal(stretched.quantity, 30); // cap 4 × 8 = 32, so 30 passes untouched
  assert.equal(stretched.clampedFrom, null);
});

test('a per-group card option is not capped and still bills its quantity', () => {
  const line = publicQuote({ selectedOptions: [{ optionId: 7, quantity: 30 }] })
    .optionLines.find((l) => l.optionId === 7);
  assert.equal(line.quantity, 30);
  assert.equal(line.billedUnits, 30);
  assert.equal(line.totalPrice, 1350);
});

test('the admin flow is untouched: occurrences still drive the billed units', () => {
  const q = calculateReservationQuote({
    db: seedDb(),
    ...STAY,
    selectedOptions: [{ optionId: 6, quantity: 2, cardOccurrences: [{ date: '2026-07-11', time: '09:00' }, { date: '2026-07-12', time: '09:00' }] }],
  });
  const line = q.optionLines.find((l) => l.optionId === 6);
  assert.equal(line.billedUnits, 8); // 2 occurrences × 4 couverts
  assert.equal(line.totalPrice, 64);
});

// ---- the caps the quote publishes (rules 7-8) ----

test('optionLimits carries the cap and its French hint, per option', () => {
  const limits = toPublicOptionLimits({
    options: [BREAKFAST, TRAPPER, ROOM], persons: 4, nights: 3, property: PROPERTY,
  });
  assert.deepEqual(limits.map((l) => l.optionId), [6, 16], 'per-group cards carry no portion cap');
  assert.equal(limits[0].maxQuantity, 12);
  assert.equal(limits[0].hint, "Jusqu'à 12 — 4 personnes × 3 matins");
  assert.equal(limits[1].maxQuantity, 24);
  assert.equal(limits[1].hint, "Jusqu'à 24 — 4 personnes × 6 repas (2 par jour)");
});

test('the hint names the lunches the times add', () => {
  const limits = toPublicOptionLimits({
    options: [TRAPPER], persons: 4, nights: 3, checkInTime: '11:00', checkOutTime: '14:00', property: PROPERTY,
  });
  assert.equal(limits[0].maxQuantity, 32);
  assert.equal(
    limits[0].hint,
    "Jusqu'à 32 — 4 personnes × 8 repas (2 par jour, déjeuner d'arrivée et déjeuner de départ inclus)",
  );
});

test('no dates or no guests → no caps to publish', () => {
  assert.deepEqual(toPublicOptionLimits({ options: [BREAKFAST], persons: 4, nights: 0 }), []);
  assert.deepEqual(toPublicOptionLimits({ options: [BREAKFAST], persons: 0, nights: 3 }), []);
});

test('the refusal message names the unit, the party and the basis', () => {
  const breakfastLimit = portionCap({ option: BREAKFAST, persons: 2, nights: 3, property: PROPERTY });
  assert.equal(
    portionWording(BREAKFAST).refusal({ ...breakfastLimit, nights: 3 }),
    '6 petits déjeuners au maximum pour 2 personnes et 3 nuits.',
  );
  const mealLimit = portionCap({ option: TRAPPER, persons: 2, nights: 3, property: PROPERTY });
  assert.equal(
    portionWording(TRAPPER).refusal({ ...mealLimit, nights: 3 }),
    '12 couverts au maximum pour 2 personnes et 6 repas.',
  );
});

// ---- property defaults (rule 5) ----

test('a per-person card default is added as one portion per guest', () => {
  const defaultsModel = { listForProperty: () => [{ optionId: 6, offered: false }] };
  const merged = mergePropertyDefaultsIntoPayload(
    { selectedOptions: [], offeredOptionIds: [] },
    1,
    defaultsModel,
    { quantityFor: (optionId) => (optionId === 6 ? 4 : 1) },
  );
  assert.deepEqual(merged.selectedOptions, [{ optionId: 6, quantity: 4 }]);
});

test('without a quantityFor, a default is still added with quantity 1', () => {
  const defaultsModel = { listForProperty: () => [{ optionId: 3, offered: true }] };
  const merged = mergePropertyDefaultsIntoPayload({ selectedOptions: [], offeredOptionIds: [] }, 1, defaultsModel);
  assert.deepEqual(merged.selectedOptions, [{ optionId: 3, quantity: 1 }]);
  assert.deepEqual(merged.offeredOptionIds, [3]);
});

// ---- the migration of devis stored under the séance meaning (rule 11) ----

function seedStoredDevis() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, priceType TEXT NOT NULL DEFAULT 'per_stay',
      showsPlanningCard INTEGER NOT NULL DEFAULT 0, isCancellationInsurance INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE reservations ( id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'devis', requestOrigin TEXT );
    CREATE TABLE reservation_options (
      id INTEGER PRIMARY KEY, reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL,
      quantity REAL NOT NULL DEFAULT 0, billedUnits REAL, unitPrice REAL, totalPrice REAL, cardOccurrences TEXT
    );
  `);
  db.prepare("INSERT INTO options (id, title, priceType, showsPlanningCard) VALUES (6, 'Petit déjeuner', 'per_person_per_night', 1)").run();
  db.prepare("INSERT INTO options (id, title, priceType, showsPlanningCard) VALUES (7, 'Location salle', 'per_stay', 1)").run();
  db.prepare("INSERT INTO reservations (id, kind, requestOrigin) VALUES (1, 'devis', 'public')").run();
  db.prepare("INSERT INTO reservations (id, kind, requestOrigin) VALUES (2, 'devis', NULL)").run();
  db.prepare("INSERT INTO reservations (id, kind, requestOrigin) VALUES (3, 'reservation', 'public')").run();
  const line = db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, billedUnits, unitPrice, totalPrice, cardOccurrences) VALUES (?, ?, ?, ?, ?, ?, ?)');
  line.run(1, 6, 2, 8, 8, 64, null); // public devis, unscheduled: 2 séances × 4 personnes
  line.run(1, 7, 3, 3, 45, 135, null); // per-group card: quantity already means what it bills
  line.run(2, 6, 2, 8, 8, 64, null); // admin devis: not ours to touch
  line.run(3, 6, 2, 8, 8, 64, null); // reservation: converted, frozen
  line.run(1, 6, 2, 8, 8, 64, '[{"date":"2026-07-11","time":"09:00"}]'); // scheduled: occurrences rule
  return db;
}

test('the migration aligns the quantity of public unscheduled per-person card lines on billedUnits', () => {
  const db = seedStoredDevis();
  const { action, changed } = runMealPortionQuantitiesMigration(db);
  assert.equal(action, 'migrated');
  assert.equal(changed, 1);

  const rows = db.prepare('SELECT id, reservationId, optionId, quantity, billedUnits, totalPrice, cardOccurrences FROM reservation_options ORDER BY id').all();
  assert.equal(rows[0].quantity, 8, 'the public unscheduled breakfast now counts portions');
  assert.equal(rows[0].totalPrice, 64, 'the money is untouched');
  assert.equal(rows[1].quantity, 3, 'per-group card untouched');
  assert.equal(rows[2].quantity, 2, 'admin devis untouched');
  assert.equal(rows[3].quantity, 2, 'reservation untouched');
  assert.equal(rows[4].quantity, 2, 'scheduled line untouched');
});

test('the migration is idempotent', () => {
  const db = seedStoredDevis();
  runMealPortionQuantitiesMigration(db);
  assert.equal(runMealPortionQuantitiesMigration(db).changed, 0);
});

test('a migrated devis replays at the very same total', () => {
  const db = seedDb();
  // What the old meaning stored: 2 séances for 4 guests = 8 billed breakfasts, 64 €.
  const migratedQuantity = 8;
  const line = calculateReservationQuote({
    db, ...STAY, selectedOptions: [{ optionId: 6, quantity: migratedQuantity }], planningCardAsQuantity: true,
  }).optionLines.find((l) => l.optionId === 6);
  assert.equal(line.billedUnits, 8);
  assert.equal(line.totalPrice, 64);
});

// ---- the booking request refuses what the quote would only clamp (rule 3) ----

function buildBookingController({ options, captures }) {
  const Module = require('module');
  const origRequire = Module.prototype.require;
  const dbMock = {
    transaction: (fn) => (...args) => fn(...args),
    prepare: () => ({ get: () => ({ maxGuests: 10, maxBabies: 2 }), run: () => ({ changes: 1 }) }),
  };
  const mocks = {
    '../../database': dbMock,
    '../../models/clientsModel': { findByEmail: () => ({ id: 7 }), insert: () => ({ id: 7 }) },
    '../../models/devisModel': { create: (payload) => { captures.devisCreate = payload; return { ok: true, data: { id: 99, devisNumber: '2026-09-00042', finalPrice: 300 } }; } },
    '../../models/optionsModel': { listForProperty: () => options },
    './publicCatalogController': { computeBlockedDates: () => [], rangeHasBlockedNight: () => false },
    './publicQuoteController': {
      buildEngineQuote: () => ({
        error: null, minNightsBreached: false, requiredMinNights: 1, finalPrice: 300,
        persons: 4, nights: 3, defaultCheckIn: '16:00', defaultCheckOut: '10:00',
      }),
      checkOptionApplicability: () => null,
      checkResourceApplicability: () => null,
    },
    '../../models/settingsModel': { termsSettings: () => ({ requireTermsAcceptance: false }), upsert: () => {} },
    '../../models/termsModel': { getCurrent: () => ({ id: 1, version: 1 }), insertAcceptance: () => {} },
  };
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
    return origRequire.call(this, id);
  };
  try {
    const path = '../controllers/public/publicBookingRequestController';
    delete require.cache[require.resolve(path)];
    return require(path);
  } finally {
    Module.prototype.require = origRequire;
  }
}

function bookingBody(over = {}) {
  return {
    propertyId: 1,
    startDate: '2026-07-10', endDate: '2026-07-13',
    adults: 4, children: 0, teens: 0, babies: 0,
    options: [],
    guest: { firstName: 'Marie', lastName: 'Durand', email: 'marie@example.com', phone: '+33612345678' },
    ...over,
  };
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('booking request: portions over the cap are refused, never quietly lowered', () => {
  const captures = {};
  const controller = buildBookingController({ options: [BREAKFAST, TRAPPER], captures });
  const res = fakeRes();
  controller.create({ body: bookingBody({ options: [{ optionId: 6, quantity: 13 }] }) }, res);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  assert.equal(res.body.error.message, '12 petits déjeuners au maximum pour 4 personnes et 3 nuits.');
  assert.deepEqual(res.body.error.details, [{ field: 'options', issue: 'option 6 quantity 13 exceeds 12' }]);
  assert.equal(captures.devisCreate, undefined, 'nothing persisted');
});

test('booking request: portions within the cap go through untouched', () => {
  const captures = {};
  const controller = buildBookingController({ options: [BREAKFAST, TRAPPER], captures });
  const res = fakeRes();
  controller.create({ body: bookingBody({ options: [{ optionId: 6, quantity: 12 }] }) }, res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(captures.devisCreate.selectedOptions, [{ optionId: 6, quantity: 12 }]);
  assert.equal(captures.devisCreate.planningCardAsQuantity, true);
});
