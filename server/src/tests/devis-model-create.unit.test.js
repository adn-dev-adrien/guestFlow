const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');

// Full pricing schema (so calculateReservationQuote runs) + devis tables, to cover the money-critical
// create/update persistence that the plain devis-model test can't reach.
const DDL = `
  CREATE TABLE properties (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL,
    depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
    defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00', defaultCautionAmount REAL DEFAULT 500,
    touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
    touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
    vatPercentageAccommodation REAL DEFAULT 20, vatPercentageOptions REAL DEFAULT 20, vatPercentageResources REAL DEFAULT 20,
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
    autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT NOT NULL DEFAULT 'fixed', autoFullNightThreshold TEXT
  );
  CREATE TABLE property_options ( propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId) );
  CREATE TABLE resources (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay', isComplex INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    devisNumber TEXT, devisStatus TEXT, validUntil TEXT, convertedReservationId INTEGER,
    propertyId INTEGER, clientId INTEGER,
    startDate TEXT, endDate TEXT, adults INTEGER DEFAULT 1, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER, checkInTime TEXT, checkOutTime TEXT, platform TEXT,
    totalPrice REAL DEFAULT 0, touristTaxRate REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0, discountPercent REAL DEFAULT 0,
    customPrice REAL, finalPrice REAL DEFAULT 0, depositAmount REAL DEFAULT 0, depositDueDate TEXT, depositPaid INTEGER DEFAULT 0,
    balanceAmount REAL DEFAULT 0, balanceDueDate TEXT, balancePaid INTEGER DEFAULT 0, cautionAmount REAL DEFAULT 0, notes TEXT, sourceType TEXT,
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE reservation_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0);
  CREATE TABLE reservation_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, resourceId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL);
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT, createdAt TEXT DEFAULT (datetime('now')));
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.generateDevisNumber = () => 'D-TEST-001';
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Maison test')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 120, 1)').run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (1, 'Ménage', 'per_stay', 50)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 1)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  return { model: devisModel.buildModel(db), db };
}

const BASE = { propertyId: 1, clientId: 1, startDate: '2026-07-10', endDate: '2026-07-13', adults: 2 };

test('create persists the devis + lines with engine prices (360 stay + 50 option)', () => {
  const { model, db } = freshModel();
  const result = model.create({ ...BASE, selectedOptions: [{ optionId: 1, quantity: 1 }] });
  assert.equal(result.status, 201);
  const full = result.data;
  assert.equal(full.devisNumber, 'D-TEST-001');
  assert.equal(full.totalPrice, 360);   // engine accommodation (120 × 3 nights)
  assert.equal(full.finalPrice, 410);   // 360 + 50 option
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_options WHERE reservationId = ?').get(full.id).c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_nights WHERE reservationId = ?').get(full.id).c, 3);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM reservation_history WHERE reservationId = ? AND eventType = 'create'").get(full.id).c, 1);
});

test('create honours a manual accommodation price (override 300 → final 350)', () => {
  const { model } = freshModel();
  const result = model.create({ ...BASE, customPrice: 300, selectedOptions: [{ optionId: 1, quantity: 1 }] });
  assert.equal(result.data.totalPrice, 360);   // engine accommodation unchanged
  assert.equal(result.data.finalPrice, 350);   // 300 manual + 50 option
  assert.equal(result.data.customPrice, 300);
});

test('create validates required fields and property existence', () => {
  const { model } = freshModel();
  assert.equal(model.create({ clientId: 1, startDate: 'a', endDate: 'b' }).status, 400); // no propertyId
  assert.equal(model.create({ ...BASE, propertyId: 999 }).status, 404); // unknown property
});

test('update recomputes, replaces lines and records a history entry (audit fix)', () => {
  const { model, db } = freshModel();
  const created = model.create({ ...BASE, selectedOptions: [{ optionId: 1, quantity: 1 }] }).data;
  const historyBefore = db.prepare('SELECT COUNT(*) c FROM reservation_history WHERE reservationId = ?').get(created.id).c;

  // Drop the option and apply a manual price → final becomes 300, option line removed.
  const updated = model.update(created.id, { ...BASE, customPrice: 300, selectedOptions: [] }).data;
  assert.equal(updated.finalPrice, 300);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_options WHERE reservationId = ?').get(created.id).c, 0);
  const historyAfter = db.prepare('SELECT COUNT(*) c FROM reservation_history WHERE reservationId = ?').get(created.id).c;
  assert.ok(historyAfter > historyBefore, 'an update history entry should be recorded'); // was always 0 before the fix
});

test('update on a missing devis → 404', () => {
  const { model } = freshModel();
  assert.equal(model.update(9999, BASE).status, 404);
});
