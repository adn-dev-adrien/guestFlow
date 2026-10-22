// Guests added after a platform booking — specs/platform-extra-guest-complement.md.
// No supplement before the brut; once it is entered, the guests above what the platform billed are
// collected on arrival, shown in the SAS and offerable.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;
const { splitExtraGuestCount } = require('../utils/pricing');
const { resolvePlatformPaidGuests } = require('../utils/platformPaidGuests');
const { create: createReservationsModel, __test: { arrivalComplementDetailFromReservation } } = require('../models/reservationsModel');

// 2 nights × 300 = 600 ; 2 guests free ; 20 €/guest/night → 40 € per extra guest.
function createPricingDb({ unit = 'per_night' } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0, extraGuestPriceUnit TEXT DEFAULT 'per_stay');
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, label TEXT, pricePerNight REAL DEFAULT 300, pricingMode TEXT DEFAULT 'fixed', progressiveTiers TEXT DEFAULT '[]', dateRanges TEXT DEFAULT '[]', color TEXT DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit) VALUES (1, 'Gite', 2, 20, ?)").run(unit);
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 300, 1)').run();
  return db;
}

const BASE = {
  propertyId: 1, startDate: '2026-05-01', endDate: '2026-05-03',
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
};

function quote(input, dbOptions) {
  const db = createPricingDb(dbOptions);
  try { return calculateReservationQuote({ ...BASE, db, ...input }); } finally { db.close(); }
}

// ---- §3.1 — no supplement before the brut ----

test('rule 1: a platform reservation without brut counts no supplement', () => {
  const q = quote({ platform: 'Booking', adults: 4 });
  assert.equal(q.extraGuestCount, 0);
  assert.equal(q.extraGuestSurcharge, 0);
  assert.equal(q.finalPrice, 600);
  assert.equal(q.platformPaidGuests, null);
});

test('rule 2: a direct reservation keeps its supplement', () => {
  const q = quote({ platform: 'direct', adults: 4 });
  assert.equal(q.extraGuestSurcharge, 80);
  assert.equal(q.finalPrice, 680);
  assert.equal(q.extraGuestComplementCount, 0);
});

test('rule 2: a Lodgify (own-site) reservation without brut keeps its supplement', () => {
  const q = quote({ platform: 'Lodgify', adults: 4 });
  assert.equal(q.extraGuestSurcharge, 80);
});

// ---- §3.3 — the split ----

test('rule 7: the composition the platform billed stays inside the brut', () => {
  const q = quote({ platform: 'Booking', adults: 4, platformGrossAmount: 680, platformPaidGuests: 4 });
  assert.equal(q.finalPrice, 680);
  assert.equal(q.extraGuestInBrutCount, 2);
  assert.equal(q.extraGuestInBrutSurcharge, 80);
  assert.equal(q.extraGuestComplementCount, 0);
  assert.equal(q.complementAmount, 0);
  assert.equal(q.baseAccommodationAdjustedPrice, 600, 'brut − in-brut supplement');
});

test('rules 8-10: a guest added after the brut is collected on arrival, on top of the brut', () => {
  const q = quote({ platform: 'Booking', adults: 5, platformGrossAmount: 680, platformPaidGuests: 4 });
  assert.equal(q.extraGuestComplementCount, 1);
  assert.equal(q.extraGuestComplementSurcharge, 40);
  assert.equal(q.extraGuestInBrutSurcharge, 80);
  assert.equal(q.baseAccommodationAdjustedPrice, 600, 'only the in-brut part comes out of the brut');
  assert.equal(q.finalPrice, 720, 'brut + the added guest');
  assert.equal(q.complementAmount, 40);
  const line = q.complementDetailLines.find((l) => l.kind === 'extraGuests');
  assert.deepEqual(line, { kind: 'extraGuests', label: 'Voyageurs ajoutés', qty: 1, unitPrice: 40, amount: 40 });
  assert.equal(q.depositAmount + q.balanceAmount, 680, 'the added guest stays out of the pre-arrival split');
});

test('rule 7: paid below the free count → the first guest above the free count is billed', () => {
  const q = quote({ platform: 'Booking', adults: 3, platformGrossAmount: 640, platformPaidGuests: 1 });
  assert.equal(q.extraGuestComplementCount, 1);
  assert.equal(q.extraGuestInBrutCount, 0);
  assert.equal(q.finalPrice, 680);
});

test('rule 7: a baby added changes nothing', () => {
  const q = quote({ platform: 'Booking', adults: 4, babies: 1, platformGrossAmount: 680, platformPaidGuests: 4 });
  assert.equal(q.extraGuestComplementCount, 0);
  assert.equal(q.finalPrice, 680);
});

test('rule 8: per-stay unit splits the same way', () => {
  const q = quote({ platform: 'Booking', adults: 5, platformGrossAmount: 640, platformPaidGuests: 4 }, { unit: 'per_stay' });
  assert.equal(q.extraGuestComplementSurcharge, 20);
  assert.equal(q.extraGuestInBrutSurcharge, 40);
  assert.equal(q.finalPrice, 660);
});

test('rule 11: the line follows the composition down and disappears', () => {
  const up = quote({ platform: 'Booking', adults: 6, platformGrossAmount: 680, platformPaidGuests: 4 });
  assert.equal(up.extraGuestComplementSurcharge, 80);
  const back = quote({ platform: 'Booking', adults: 3, platformGrossAmount: 680, platformPaidGuests: 4 });
  assert.equal(back.extraGuestComplementCount, 0);
  assert.equal(back.finalPrice, 680);
});

test('a pinned brut without paid base keeps today\'s behaviour: everything inside the brut', () => {
  const q = quote({ platform: 'Booking', adults: 5, platformGrossAmount: 720 });
  assert.equal(q.extraGuestComplementCount, 0);
  assert.equal(q.finalPrice, 720);
  assert.equal(q.extraGuestInBrutSurcharge, 120);
});

// ---- §3.4 — offering ----

test('rule 13: « Offrir » hides the added guests only, real price kept', () => {
  const q = quote({ platform: 'Booking', adults: 5, platformGrossAmount: 680, platformPaidGuests: 4, extraGuestSurchargeOffered: true });
  assert.equal(q.extraGuestComplementSurcharge, 0);
  assert.equal(q.extraGuestComplementOriginal, 40);
  assert.equal(q.extraGuestInBrutSurcharge, 80, 'the part the platform billed is never offered');
  assert.equal(q.baseAccommodationAdjustedPrice, 600);
  assert.equal(q.finalPrice, 680);
  assert.equal(q.complementAmount, 0);
});

test('rule 13: on a direct reservation « Offrir » still hides the whole supplement', () => {
  const q = quote({ platform: 'direct', adults: 4, extraGuestSurchargeOffered: true });
  assert.equal(q.extraGuestSurcharge, 0);
  assert.equal(q.finalPrice, 600);
});

// ---- the pure helpers ----

test('splitExtraGuestCount: guests above max(free, paid) go to the complement', () => {
  assert.deepEqual(splitExtraGuestCount({ persons: 5, includedGuests: 2, paidGuests: 4 }), { complementGuests: 1, inBrutGuests: 2 });
  assert.deepEqual(splitExtraGuestCount({ persons: 3, includedGuests: 2, paidGuests: 1 }), { complementGuests: 1, inBrutGuests: 0 });
  assert.deepEqual(splitExtraGuestCount({ persons: 5, includedGuests: 2, paidGuests: null }), { complementGuests: 0, inBrutGuests: 3 });
});

test('rules 4-6: the paid base is captured with the brut, kept on a correction, cleared with it', () => {
  const body = (extra) => ({ platform: 'Booking', adults: 4, teens: 1, children: 0, babies: 2, ...extra });
  assert.equal(resolvePlatformPaidGuests(null, body({ platformGrossAmount: '' })), null, 'no brut → no base');
  assert.equal(resolvePlatformPaidGuests(null, body({ platformGrossAmount: 600 })), 5, 'captured, babies excluded');
  const stored = { platform: 'Booking', platformGrossAmount: 600, platformPaidGuests: 4 };
  assert.equal(resolvePlatformPaidGuests(stored, body({ platformGrossAmount: 610 })), 4, 'a corrected brut keeps the base');
  assert.equal(resolvePlatformPaidGuests(stored, body({ platformGrossAmount: '' })), null, 'clearing the brut clears it');
  assert.equal(resolvePlatformPaidGuests(stored, { ...body({ platformGrossAmount: 600 }), platform: 'direct' }), null, 'direct clears it');
  const cleared = { platform: 'Booking', platformGrossAmount: null, platformPaidGuests: null };
  assert.equal(resolvePlatformPaidGuests(cleared, body({ platformGrossAmount: 620 })), 5, 're-entered → captured again');
});

// ---- §3.5 — the stored line: SAS recap and commit ----

function makeModelDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
      adults INTEGER NOT NULL DEFAULT 0, teens INTEGER NOT NULL DEFAULT 0, children INTEGER NOT NULL DEFAULT 0, babies INTEGER NOT NULL DEFAULT 0,
      cautionAmount REAL DEFAULT 0, cautionReceived INTEGER DEFAULT 0, cautionReceivedDate TEXT,
      cautionReturned INTEGER DEFAULT 0, cautionReturnedDate TEXT,
      complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
      complementPaidDate TEXT, complementPaidCash INTEGER NOT NULL DEFAULT 0,
      complementDeferredToCheckout INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementAmount REAL NOT NULL DEFAULT 0, endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0, endOfStayComplementDetail TEXT,
      arrivalSasDoneAt TEXT, departureSasDoneAt TEXT,
      checkInReady INTEGER DEFAULT 0, checkInDone INTEGER DEFAULT 0, checkOutDone INTEGER DEFAULT 0,
      extinguisherSealOkAtArrival INTEGER, extinguisherSealOkAtDeparture INTEGER,
      breakfastTime TEXT,
      breakfastCoffee INTEGER NOT NULL DEFAULT 0, breakfastTea INTEGER NOT NULL DEFAULT 0,
      breakfastChocolate INTEGER NOT NULL DEFAULT 0, breakfastMilk INTEGER NOT NULL DEFAULT 0,
      breakfastPastries INTEGER NOT NULL DEFAULT 0, breakfastCereals INTEGER NOT NULL DEFAULT 0,
      breakfastBread REAL NOT NULL DEFAULT 0, breakfastNotifiedDate TEXT,
      breakfastNote TEXT, departureHandoverNote TEXT,
      touristTaxInComplement INTEGER NOT NULL DEFAULT 0,
      extraGuestSurchargeOffered INTEGER NOT NULL DEFAULT 0, platformPaidGuests INTEGER,
      extraGuestComplementSurcharge REAL NOT NULL DEFAULT 0, extraGuestComplementCount INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT
    );
    CREATE TABLE reservation_custom_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL,
      sasArrivalOrigin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, autoOptionType TEXT, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay');
    CREATE TABLE reservation_options (
      reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL,
      quantity REAL DEFAULT 1, unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0,
      priceType TEXT NOT NULL DEFAULT 'per_stay', totalPrice REAL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0,
      inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL,
      sasArrivalOrigin INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (reservationId, optionId)
    );
    CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', propertyId INTEGER, note TEXT);
    CREATE TABLE reservation_resources (
      reservationId INTEGER NOT NULL, resourceId INTEGER NOT NULL, quantity REAL DEFAULT 1,
      unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0, totalPrice REAL DEFAULT 0,
      offered INTEGER NOT NULL DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (reservationId, resourceId)
    );
    CREATE TABLE reservation_nights (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, date TEXT);
    CREATE TABLE property_option_prices (propertyId INTEGER, optionId INTEGER, price REAL, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE linen_priced_items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'bed', sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE repair_amounts (id INTEGER PRIMARY KEY AUTOINCREMENT, repairKey TEXT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, defaultCautionAmount REAL DEFAULT 0);
  `);
  db.prepare('INSERT INTO properties (id, defaultCautionAmount) VALUES (7, 0)').run();
  db.prepare(`INSERT INTO reservations (id, propertyId, platform, adults, complementAmount, platformPaidGuests,
    extraGuestComplementSurcharge, extraGuestComplementCount) VALUES (1, 7, 'Booking', 5, 40, 4, 40, 1)`).run();
  return db;
}

test('rule 17: the arrival complement detail itemises the added guests with an offer ref', () => {
  const db = makeModelDb();
  const r = db.prepare('SELECT * FROM reservations WHERE id = 1').get();
  const { detail } = arrivalComplementDetailFromReservation({ ...r, options: [], resources: [] });
  assert.deepEqual(detail, [{
    kind: 'extraGuests', label: 'Voyageurs ajoutés', qty: 1, unitPrice: 40, amount: 40, ref: { kind: 'extraGuests', id: 0 },
  }]);
  db.close();
});

test('rule 17: offering the added guests from the arrival SAS zeroes them, undoing bills them back', () => {
  const db = makeModelDb();
  const model = createReservationsModel(db);
  const row = () => db.prepare('SELECT complementAmount, extraGuestSurchargeOffered, extraGuestComplementSurcharge FROM reservations WHERE id = 1').get();
  model.commitArrivalSas(1, { offeredExtras: [{ kind: 'extraGuests', id: 0 }] });
  assert.deepEqual(row(), { complementAmount: 0, extraGuestSurchargeOffered: 1, extraGuestComplementSurcharge: 40 });
  const r = db.prepare('SELECT * FROM reservations WHERE id = 1').get();
  const { detail } = arrivalComplementDetailFromReservation({ ...r, options: [], resources: [] }, { includeOffered: true });
  assert.equal(detail[0].offered, 1);
  assert.equal(detail[0].originalAmount, 40);
  model.commitArrivalSas(1, { offeredExtras: [] });
  assert.deepEqual(row(), { complementAmount: 40, extraGuestSurchargeOffered: 0, extraGuestComplementSurcharge: 40 });
  db.close();
});
