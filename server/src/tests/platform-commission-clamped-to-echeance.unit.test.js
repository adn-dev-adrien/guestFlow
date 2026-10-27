const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;
const { setDirectChannels } = require('../utils/platformNameFormat');

// specs/platform-per-echeance-commission.md rules 3 and 7 — spec review 2026-10-27 (agent 4 #1).
// « Commission > its échéance amount → clamped to the amount (net cash ≥ 0). » The engine only
// floored at 0: a 100 € commission typed on a platform stay with no acompte gave a −100 € acompte net
// that finance summed as cash.

function createDb({ mode = 'percentage_accommodation', includedGuests = 2 } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, depositPercent REAL DEFAULT 0,
      depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
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
    CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT, collectsTouristTax INTEGER DEFAULT 1,
      touristTaxRemittedByPlatform INTEGER DEFAULT 1);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare(`INSERT INTO properties
      (id, name, touristTaxMode, touristTaxPercentage, touristTaxDepartmentPercentage, touristTaxPerDayPerPerson,
       basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit)
    VALUES (1, 'Aventura lodge', ?, ?, ?, ?, ?, 25, 'per_stay')`)
    .run(
      mode,
      mode === 'per_day_per_person' ? 0 : 5,
      mode === 'per_day_per_person' ? 0 : 10,
      mode === 'per_day_per_person' ? 1.2 : 0,
      includedGuests,
    );
  db.prepare(`INSERT INTO pricing_rules (id, propertyId, pricePerNight, dateRanges)
    VALUES (1, 1, 119.93, '[{"startDate":"2026-01-01","endDate":"2026-12-31"}]')`).run();
  const addOption = db.prepare('INSERT INTO options (id, title, priceType, price) VALUES (?, ?, ?, ?)');
  addOption.run(7, 'Ménage', 'per_stay', 30);
  addOption.run(8, 'Linge de lit', 'per_person', 7);
  addOption.run(9, 'Linge de toilette', 'per_person', 8);
  addOption.run(11, 'Panier gourmand', 'per_stay', 45);
  const addApplicable = db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)');
  for (const id of [7, 8, 9, 11]) addApplicable.run(id);
  const addDefault = db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, ?, 1)');
  for (const id of [7, 8, 9]) addDefault.run(id);
  db.prepare("INSERT INTO resources (id, name, quantity, price, priceType) VALUES (20, 'Bain nordique', 1, 90, 'per_stay')").run();
  db.prepare("INSERT INTO platforms (id, name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES (1, 'Booking', 0, 0)").run();
  return db;
}

const BASE = {
  propertyId: 1, startDate: '2026-05-01', endDate: '2026-05-04',
  checkInTime: '15:00', checkOutTime: '10:00', adults: 2, children: 0, teens: 0, babies: 0,
  selectedOptions: [], customOptions: [], selectedResources: [], discountPercent: 0, customPrice: '',
};

const PLATFORM_STAY = { ...BASE, platform: 'Booking', platformGrossAmount: 450 };

test('an acompte commission on a stay without acompte is clamped to 0', () => {
  setDirectChannels(['direct']);
  const db = createDb();
  const q = calculateReservationQuote({ ...PLATFORM_STAY, db, acompteCommissionAmount: 100, platformCommissionAmount: 60 });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.acompteCommissionAmount, 0);
  assert.equal(q.platformCommissionAmount, 60);
  assert.equal(q.totalPlatformCommission, 60);
  db.close();
});

test('a solde commission above the solde is clamped to the solde — the net never goes negative', () => {
  setDirectChannels(['direct']);
  const db = createDb();
  const q = calculateReservationQuote({ ...PLATFORM_STAY, db, platformCommissionAmount: 9999 });
  assert.equal(q.platformCommissionAmount, q.balanceAmount);
  assert.ok(q.platformNetReceivedAmount >= 0, `net ${q.platformNetReceivedAmount}`);
  db.close();
});

test('a commission within its échéance is kept to the cent', () => {
  setDirectChannels(['direct']);
  const db = createDb();
  const q = calculateReservationQuote({ ...PLATFORM_STAY, db, platformCommissionAmount: 74.25 });
  assert.equal(q.platformCommissionAmount, 74.25);
  db.close();
});

// The stored figure is the engine's clamped one, so finance (which reads the column) never sees more
// commission than the échéance carried.
const fs = require('fs');
const path = require('path');
const reservationsModel = require('../models/reservationsModel');

function freshModel() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  return { db, model: reservationsModel.create(db) };
}

test('the reservation stores the clamped commissions, not the typed ones', () => {
  const { db, model } = freshModel();
  const quote = {
    totalPrice: 300, touristTaxRate: 0, touristTaxTotal: 0, discountPercent: 0, finalPrice: 300,
    depositAmount: 0, depositDueDate: null, balanceAmount: 300, balanceDueDate: null, complementAmount: 0,
    acompteCommissionAmount: 0, platformCommissionAmount: 300,
  };
  const id = model.insertReservation({
    propertyId: 1, clientId: 1, startDate: '2026-09-10', endDate: '2026-09-13', adults: 2,
    platform: 'Airbnb', acompteCommissionAmount: 100, platformCommissionAmount: 450,
  }, quote, { blocksPreviousNight: 0, blocksNextNight: 0 });
  const row = db.prepare('SELECT acompteCommissionAmount, platformCommissionAmount FROM reservations WHERE id = ?').get(id);
  assert.deepEqual({ ...row }, { acompteCommissionAmount: 0, platformCommissionAmount: 300 });
  db.close();
});
