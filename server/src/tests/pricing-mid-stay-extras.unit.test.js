// Routage moteur des prestations vendues en cours de séjour.
// See specs/mid-stay-extras-to-end-of-stay-complement.md §3.3.
//
// Invariant asserted everywhere below: acompte + solde + complément d'arrivée + complément de fin de
// séjour === total du séjour. Before this spec an extra sold mid-stay grew the total and no bucket.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
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
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Tente')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (9, 'Petit-déjeuner', 'per_stay', 12)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 9)').run();
  return db;
}

// 2 nights × 100 € = 200 € accommodation. Deposit + balance already collected on that 200 €.
const BASE = {
  propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-12',
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
  depositPaid: true, balancePaid: true, complementPaid: true, complementAmount: 0,
};
const DIRECT = { ...BASE, platform: 'direct', depositAmount: 60, balanceAmount: 140 };
const PLATFORM = { ...BASE, platform: 'airbnb', depositAmount: 0, balanceAmount: 200 };

const collected = (q) => Math.round(
  (q.depositAmount + q.balanceAmount + q.complementAmount + q.endOfStayComplementTotal) * 100,
) / 100;

test('direct — un petit-déjeuner vendu en cours de séjour part au complément de fin de séjour', () => {
  const q = calculateReservationQuote({
    ...DIRECT, db: createDb(), selectedOptions: [{ optionId: 9, quantity: 1 }],
    arrivalExtrasBaseline: '{}',
  });
  assert.equal(q.totalStayPrice, 212);
  assert.equal(q.depositAmount, 60);
  assert.equal(q.balanceAmount, 140, 'the frozen pre-arrival buckets never move');
  assert.equal(q.complementAmount, 0, 'the arrival complement stays frozen at what was collected');
  assert.equal(q.midStayExtrasTotal, 12);
  assert.equal(q.endOfStayComplementTotal, 12);
  assert.equal(collected(q), 212, 'every euro of the stay is now claimed by a bucket');
});

test('plateforme — même résultat quand l\'extra est routé au complément par défaut', () => {
  const q = calculateReservationQuote({
    ...PLATFORM, db: createDb(), selectedOptions: [{ optionId: 9, quantity: 1 }],
    arrivalExtrasBaseline: '{}',
  });
  assert.equal(q.complementAmount, 0);
  assert.equal(q.midStayExtrasTotal, 12);
  assert.equal(collected(q), 212);
  assert.equal(q.preArrivalAmount, 200, 'the platform is never asked to settle an on-site sale');
});

test('le complément d\'arrivée NON réglé part quand même en fin de séjour (décision Q2)', () => {
  const q = calculateReservationQuote({
    ...PLATFORM, db: createDb(), complementPaid: false,
    selectedOptions: [{ optionId: 9, quantity: 1 }],
    arrivalExtrasBaseline: '{}',
  });
  assert.equal(q.complementAmount, 0, 'it no longer inflates the arrival complement');
  assert.equal(q.endOfStayComplementTotal, 12);
  assert.equal(collected(q), 212);
});

test('hausse de quantité — seule l\'unité ajoutée bascule', () => {
  const q = calculateReservationQuote({
    ...DIRECT, db: createDb(), depositAmount: 63.6, balanceAmount: 148.4,
    selectedOptions: [{ optionId: 9, quantity: 2 }],
    arrivalExtrasBaseline: JSON.stringify({ 'opt:9': 12 }),
  });
  assert.equal(q.totalStayPrice, 224);
  assert.equal(q.midStayExtrasTotal, 12);
  assert.equal(collected(q), 224);
});

test('séjour non commencé (aucune base) — moteur strictement inchangé', () => {
  const withBaseline = calculateReservationQuote({
    ...DIRECT, db: createDb(), depositPaid: false, balancePaid: false, complementPaid: false,
    selectedOptions: [{ optionId: 9, quantity: 1 }], arrivalExtrasBaseline: null,
  });
  const legacy = calculateReservationQuote({
    ...DIRECT, db: createDb(), depositPaid: false, balancePaid: false, complementPaid: false,
    selectedOptions: [{ optionId: 9, quantity: 1 }],
  });
  assert.equal(withBaseline.midStayExtrasTotal, 0);
  assert.equal(withBaseline.depositAmount, legacy.depositAmount);
  assert.equal(withBaseline.balanceAmount, legacy.balanceAmount);
  assert.equal(withBaseline.complementAmount, legacy.complementAmount);
  assert.equal(withBaseline.preArrivalAmount, legacy.preArrivalAmount);
});

test('complément de fin de séjour encaissé — la part vendue est gelée sur les lignes stockées', () => {
  const q = calculateReservationQuote({
    ...DIRECT, db: createDb(), selectedOptions: [{ optionId: 9, quantity: 2 }],
    arrivalExtrasBaseline: '{}',
    endOfStayComplementSettled: true,
    endOfStaySasAmount: 0,
    frozenMidStayLines: [{ label: 'Petit-déjeuner', qty: 1, unitPrice: 12, amount: 12, source: 'midStayExtra', key: 'opt:9' }],
  });
  assert.equal(q.midStayExtrasTotal, 12, 'the collected amount is never re-priced');
  assert.equal(q.endOfStayComplementTotal, 12);
});

test('le complément de fin de séjour du SAS s\'ajoute aux ventes en cours de séjour', () => {
  const q = calculateReservationQuote({
    ...DIRECT, db: createDb(), selectedOptions: [{ optionId: 9, quantity: 1 }],
    arrivalExtrasBaseline: '{}',
    endOfStaySasAmount: 60, // ménage facturé au départ
  });
  assert.equal(q.endOfStayComplementTotal, 72);
  assert.equal(q.sejourNetTotal, 272, 'le total de la fiche intègre tout le complément de fin de séjour');
});

test('sejourNetTotal — plateforme avec commission : versement net + compléments perçus sur place', () => {
  const q = calculateReservationQuote({
    ...PLATFORM, db: createDb(), selectedOptions: [{ optionId: 9, quantity: 1 }],
    arrivalExtrasBaseline: '{}', platformCommissionAmount: 20,
  });
  assert.equal(q.platformNetReceivedAmount, 180, '200 pré-arrivée − 20 de commission');
  assert.equal(q.sejourNetTotal, 192, '180 + 12 vendus sur place');
});
