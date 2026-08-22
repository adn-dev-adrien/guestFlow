const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');

// Non-regression guard for the bug where property option defaults (typically the
// per-property `Linge de lit` / `Linge de toilette` linen options) were silently
// dropped from new devis. The server now enforces the merge regardless of what the
// client ships (specs/devis-pdf-and-tourist-tax-fixes.md §3.3).

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, defaultCheckIn TEXT, defaultCheckOut TEXT, defaultCautionAmount REAL, depositPercent REAL, depositDaysBefore INTEGER, balanceDaysBefore INTEGER, minNights INTEGER, basePrice REAL);
  CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, pricePerNight REAL, minNights INTEGER, startDate TEXT, endDate TEXT);
  CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, priceType TEXT, price REAL, autoOptionType TEXT, autoFullNightThreshold TEXT);
  CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY(propertyId, optionId));
  CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, priceType TEXT, price REAL);
  CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY(propertyId, resourceId));
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, devisNumber TEXT, devisStatus TEXT, validUntil TEXT, convertedReservationId INTEGER,
    propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT,
    adults INTEGER, children INTEGER, teens INTEGER, babies INTEGER,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER, checkInTime TEXT, checkOutTime TEXT,
    platform TEXT, totalPrice REAL, touristTaxRate REAL, touristTaxTotal REAL, discountPercent REAL,
    customPrice REAL, finalPrice REAL, depositAmount REAL, depositDueDate TEXT, depositPaid INTEGER DEFAULT 0,
    balanceAmount REAL, balanceDueDate TEXT, balancePaid INTEGER DEFAULT 0,
    cautionAmount REAL, notes TEXT, sourceType TEXT,
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT
  );
  CREATE TABLE reservation_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0);
  CREATE TABLE reservation_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, resourceId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL);
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT, createdAt TEXT DEFAULT (datetime('now')));
  CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(propertyId, optionId));
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, quoteValidityDays INTEGER NOT NULL DEFAULT 30);
  INSERT INTO app_settings (id, quoteValidityDays) VALUES (1, 30);
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.generateDevisNumber = () => 'D-TEST-001';
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (10, 'Linge de lit', 'per_stay', 25)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (11, 'Linge de toilette', 'per_stay', 15)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (12, 'Petit dej', 'per_stay', 10)").run();
  // specs/option-property-scope.md: options apply only where explicitly linked — link all to Gite.
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 10), (1, 11), (1, 12)').run();
  return { model: devisModel.buildModel(db), db };
}

const BASE = { propertyId: 1, clientId: 1, startDate: '2026-08-10', endDate: '2026-08-12', adults: 2 };

test('create merges every property default option not present in the payload', () => {
  const { model, db } = freshModel();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 10, 0)').run();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 11, 0)').run();

  const result = model.create({ ...BASE, selectedOptions: [] });
  const optIds = db.prepare('SELECT optionId FROM reservation_options WHERE reservationId = ? ORDER BY optionId').all(result.data.id).map((r) => Number(r.optionId));
  assert.deepEqual(optIds, [10, 11]);
});

test('create does NOT duplicate a default already present in the payload', () => {
  const { model, db } = freshModel();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 10, 0)').run();

  const result = model.create({ ...BASE, selectedOptions: [{ optionId: 10, quantity: 1 }] });
  const rows = db.prepare('SELECT optionId FROM reservation_options WHERE reservationId = ? AND optionId = 10').all(result.data.id);
  assert.equal(rows.length, 1, 'exactly one line for the explicitly-provided default');
});

test('create is a no-op when the property has no defaults configured', () => {
  const { model, db } = freshModel();
  const result = model.create({ ...BASE, selectedOptions: [{ optionId: 12, quantity: 1 }] });
  const ids = db.prepare('SELECT optionId FROM reservation_options WHERE reservationId = ?').all(result.data.id).map((r) => Number(r.optionId));
  assert.deepEqual(ids, [12]);
});

test('create propagates the `offered` flag on default options into reservation_options', () => {
  const { model, db } = freshModel();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 10, 1)').run();

  const result = model.create({ ...BASE, selectedOptions: [] });
  const row = db.prepare('SELECT offered FROM reservation_options WHERE reservationId = ? AND optionId = 10').get(result.data.id);
  assert.equal(Number(row.offered), 1, '`offered` default = included in the price');
});

// ── update: an included service cannot be dropped ───────────────────────────────────────
// specs/tourist-tax-included-services-deduction.md rules 4-5 — the devis has the same contract as
// the fiche réservation: a property default marked « offerte » is included and mandatory, so a
// payload that omits it is corrected rather than obeyed. Still bounded by what the devis carries
// (specs/reservation-option-immutability.md rule 3).

const UPDATE_BASE = { ...BASE, startDate: '2030-08-10', endDate: '2030-08-12' };

test('update puts back an offered default the payload dropped', () => {
  const { model, db } = freshModel();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 10, 1)').run();
  const devis = model.create({ ...UPDATE_BASE, selectedOptions: [] }).data;

  model.update(devis.id, { ...UPDATE_BASE, selectedOptions: [{ optionId: 12, quantity: 1 }], offeredOptionIds: [] });

  const rows = db.prepare('SELECT optionId, offered, totalPrice FROM reservation_options WHERE reservationId = ? ORDER BY optionId').all(devis.id);
  assert.deepEqual(rows.map((r) => Number(r.optionId)), [10, 12]);
  const included = rows.find((r) => Number(r.optionId) === 10);
  assert.equal(Number(included.offered), 1, 'it comes back as « comprise », not billed');
  assert.equal(Number(included.totalPrice), 0);
});

test('update does not add an offered default the devis never carried', () => {
  const { model, db } = freshModel();
  const devis = model.create({ ...UPDATE_BASE, selectedOptions: [{ optionId: 12, quantity: 1 }] }).data;
  // The operator configures the default AFTER the devis was issued: it must not reach this one.
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 10, 1)').run();

  model.update(devis.id, { ...UPDATE_BASE, selectedOptions: [{ optionId: 12, quantity: 1 }], offeredOptionIds: [] });

  const ids = db.prepare('SELECT optionId FROM reservation_options WHERE reservationId = ?').all(devis.id).map((r) => Number(r.optionId));
  assert.deepEqual(ids, [12]);
});

test('update leaves a BILLED default removable', () => {
  const { model, db } = freshModel();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 10, 0)').run();
  const devis = model.create({ ...UPDATE_BASE, selectedOptions: [] }).data;

  model.update(devis.id, { ...UPDATE_BASE, selectedOptions: [], offeredOptionIds: [] });

  const ids = db.prepare('SELECT optionId FROM reservation_options WHERE reservationId = ?').all(devis.id).map((r) => Number(r.optionId));
  assert.deepEqual(ids, [], 'a paid default is an ordinary option the operator may remove');
});
