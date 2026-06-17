const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');

/**
 * Property option defaults on a site devis (specs/site-booking-notifications.md §3 rules 13–15).
 *
 * Drives `devisModel.create` (what the public booking-request controller calls). The property has
 * two default options:
 *   - a PAID default that ALSO carries an autoOptionType but is not auto-enabled (the cross-check
 *     with the §1 filter fix) → must persist WITH its price;
 *   - an OFFERED default → must persist SELECTED but at totalPrice 0 with offered=1.
 * The visitor adds one extra paid option; nothing must be dropped.
 */

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT, defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00', defaultCautionAmount REAL DEFAULT 0, depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7, minNights INTEGER DEFAULT 1, basePrice REAL DEFAULT 0);
  CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER, pricePerNight REAL, minNights INTEGER, startDate TEXT, endDate TEXT);
  CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT, price REAL, autoOptionType TEXT, autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT, countsAsBedLinen INTEGER DEFAULT 0);
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
  db.generateDevisNumber = () => 'D-TEST-002';
  db.prepare("INSERT INTO app_settings (id, quoteValidityDays, vatRate) VALUES (1, 30, 10)").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Marie', 'Durand', 'marie@example.com')").run();
  // 8 = linen: carries an autoOptionType (bed_linen) but autoEnabled=0 → a normal selectable default.
  db.prepare("INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled) VALUES (8, 'Linge de lit', 'per_person', 7, 'bed_linen', 0)").run();
  // 6 = breakfast: autoOptionType but autoEnabled=0.
  db.prepare("INSERT INTO options (id, title, priceType, price, autoOptionType, autoEnabled) VALUES (6, 'Petit déjeuner', 'per_person', 9, 'breakfast', 0)").run();
  // 3 = plain paid option, what the visitor adds explicitly.
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (3, 'Ménage', 'per_stay', 80)").run();
  // specs/option-property-scope.md: options are applicable only where explicitly linked — link all to Gite.
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 8), (1, 6), (1, 3)').run();
  return { model: devisModel.buildModel(db), db };
}

const BASE = {
  propertyId: 1, clientId: 1, startDate: '2026-09-11', endDate: '2026-09-14',
  adults: 2, children: 0, teens: 0, babies: 0,
  checkInTime: '15:00', checkOutTime: '10:00', platform: 'direct',
};

test('paid default (with autoOptionType, autoEnabled=0) + offered default both land on the devis', () => {
  const { model, db } = freshModel();
  // 8 = PAID default; 6 = OFFERED default.
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 8, 0)').run();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 6, 1)').run();

  // The visitor only sends one extra paid option; the defaults are enforced server-side.
  const result = model.create({ ...BASE, selectedOptions: [{ optionId: 3, quantity: 1 }], selectedResources: [] });
  const rows = db.prepare('SELECT optionId, totalPrice, offered FROM reservation_options WHERE reservationId = ? ORDER BY optionId').all(result.data.id);
  const byId = new Map(rows.map((r) => [Number(r.optionId), r]));

  assert.ok(byId.has(8), 'paid default present');
  assert.equal(Number(byId.get(8).offered), 0, 'paid default not offered');
  assert.ok(Number(byId.get(8).totalPrice) > 0, 'paid default carries its price (2 pers × 7)');

  assert.ok(byId.has(6), 'offered default present');
  assert.equal(Number(byId.get(6).offered), 1, 'offered default flagged offered');
  assert.equal(Number(byId.get(6).totalPrice), 0, 'offered default billed at 0');

  assert.ok(byId.has(3), "visitor's explicit option present");
});

test('a default carrying an autoOptionType is NOT dropped by the option filter (cross-check with §1 fix)', () => {
  const { model, db } = freshModel();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 8, 0)').run();

  const result = model.create({ ...BASE, selectedOptions: [], selectedResources: [] });
  const ids = db.prepare('SELECT optionId FROM reservation_options WHERE reservationId = ?').all(result.data.id).map((r) => Number(r.optionId));
  assert.deepEqual(ids, [8], 'the bed_linen default survived the merge + filter');
});

test('Gîte case: an OFFERED bed-linen default (countsAsBedLinen) lands on the devis at 0 €', () => {
  // Mirrors the live Gîte: "Linge de lits" (option 8, bed_linen, autoEnabled=0, countsAsBedLinen=1)
  // is a property default flagged offered. With no visitor selection, it must still appear on the
  // devis at 0 € + offered=1 — which is what drives the BedLinenInputsBlock (bed config) to show.
  const { model, db } = freshModel();
  db.prepare('UPDATE options SET countsAsBedLinen = 1 WHERE id = 8').run();
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 8, 1)').run();

  const result = model.create({ ...BASE, selectedOptions: [], selectedResources: [] });
  const row = db.prepare('SELECT totalPrice, offered FROM reservation_options WHERE reservationId = ? AND optionId = 8').get(result.data.id);
  assert.ok(row, 'the offered bed-linen default is persisted');
  assert.equal(Number(row.offered), 1, 'flagged offered');
  assert.equal(Number(row.totalPrice), 0, 'billed at 0 €');
});
