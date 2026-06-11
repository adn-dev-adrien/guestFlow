const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');

/**
 * Regression guard for the site-booking options bug (specs/site-booking-notifications.md §1).
 *
 * `devisModel.create` is exactly what the PUBLIC booking-request controller calls, with the same
 * payload shape (`selectedOptions: [{ optionId, quantity }]`, `selectedResources: [...]`). The bug:
 * the option pre-filter dropped EVERY selected option carrying an `autoOptionType`, even when it is
 * NOT engine-managed (`autoEnabled = 0`) — so breakfast / linen chosen on the website vanished from
 * the devis. The fix only drops genuinely engine-managed auto-options (`autoOptionType` AND
 * `autoEnabled = 1`).
 */

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00', defaultCautionAmount REAL DEFAULT 0, depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7, minNights INTEGER DEFAULT 1, basePrice REAL DEFAULT 0);
  CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, pricePerNight REAL, minNights INTEGER, startDate TEXT, endDate TEXT);
  CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT, price REAL, autoOptionType TEXT, autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
  CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY(propertyId, optionId));
  CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, priceType TEXT, price REAL);
  CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY(propertyId, resourceId));
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, phone TEXT, email TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, devisNumber TEXT, devisStatus TEXT, validUntil TEXT, convertedReservationId INTEGER, requestOrigin TEXT DEFAULT '',
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
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, quoteValidityDays INTEGER NOT NULL DEFAULT 30, vatRate REAL NOT NULL DEFAULT 10);
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.generateDevisNumber = () => 'D-TEST-001';
  db.prepare("INSERT INTO app_settings (id, quoteValidityDays, vatRate) VALUES (1, 30, 10)").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Marie', 'Durand', 'marie@example.com')").run();
  // Manually selectable add-ons that carry an autoOptionType but are NOT auto-enabled.
  db.prepare("INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled) VALUES (6, 'Petit déjeuner', 'per_person_per_night', 8, 'breakfast', 0)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled) VALUES (8, 'Linge de lit', 'per_person', 7, 'bed_linen', 0)").run();
  // A genuinely engine-managed auto-option (time-driven).
  db.prepare("INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled) VALUES (1, 'Arrivée anticipée', 'per_stay', 0, 'early_check_in', 1)").run();
  // A plain paid option (no autoOptionType).
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (3, 'Ménage', 'per_stay', 80)").run();
  db.prepare("INSERT INTO resources (id, name, priceType, price) VALUES (2, 'Bain nordique', 'per_stay', 30)").run();
  return { model: devisModel.buildModel(db), db };
}

const BASE = {
  propertyId: 1, clientId: 1, startDate: '2026-09-11', endDate: '2026-09-14',
  adults: 2, children: 0, teens: 0, babies: 0,
  checkInTime: '15:00', checkOutTime: '10:00', platform: 'direct',
};

function optionRows(db, devisId) {
  return db.prepare('SELECT optionId, totalPrice FROM reservation_options WHERE reservationId = ? ORDER BY optionId').all(devisId);
}

test('site devis keeps manually-selected breakfast & linen (autoOptionType but autoEnabled=0)', () => {
  const { model, db } = freshModel();
  const result = model.create({
    ...BASE,
    selectedOptions: [{ optionId: 6, quantity: 2 }, { optionId: 8, quantity: 2 }, { optionId: 3, quantity: 1 }],
    selectedResources: [],
  });
  const rows = optionRows(db, result.data.id);
  const ids = rows.map((r) => Number(r.optionId));
  assert.ok(ids.includes(6), 'breakfast persisted (was dropped before the fix)');
  assert.ok(ids.includes(8), 'linen persisted (was dropped before the fix)');
  assert.ok(ids.includes(3), 'plain paid option persisted');
  const breakfast = rows.find((r) => Number(r.optionId) === 6);
  const linen = rows.find((r) => Number(r.optionId) === 8);
  assert.ok(Number(breakfast.totalPrice) > 0, 'breakfast priced (2 pers × 3 nights × 8)');
  assert.ok(Number(linen.totalPrice) > 0, 'linen priced (2 pers × 7)');
});

test('an engine-managed auto-option (autoEnabled=1) is never duplicated from the selection', () => {
  const { model, db } = freshModel();
  // The visitor "selected" the early-check-in option but kept the default arrival time → the engine
  // owns it (and won't add it without an early time). The selection copy must NOT create a stray line.
  const result = model.create({
    ...BASE,
    checkInTime: '15:00', // = default → no early arrival
    selectedOptions: [{ optionId: 1, quantity: 1 }, { optionId: 3, quantity: 1 }],
    selectedResources: [],
  });
  const ids = optionRows(db, result.data.id).map((r) => Number(r.optionId));
  assert.ok(ids.filter((id) => id === 1).length <= 1, 'early-check-in never appears twice');
  assert.ok(ids.includes(3), 'the plain option is unaffected');
});

test('site devis persists every selected resource', () => {
  const { model, db } = freshModel();
  const result = model.create({
    ...BASE,
    selectedOptions: [],
    selectedResources: [{ resourceId: 2, quantity: 1 }],
  });
  const rows = db.prepare('SELECT resourceId, totalPrice FROM reservation_resources WHERE reservationId = ?').all(result.data.id);
  assert.equal(rows.length, 1, 'one resource line');
  assert.equal(Number(rows[0].resourceId), 2, 'Bain nordique persisted');
  assert.ok(Number(rows[0].totalPrice) > 0, 'resource priced');
});
