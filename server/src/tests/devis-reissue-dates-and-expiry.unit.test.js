const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// specs/deposit-blocks-the-dates.md rule 17 and specs/devis-pdf-and-tourist-tax-fixes.md rules 21-22 —
// a devis re-issued by a save owes its single payment on its NEW validity date (the fiche said
// « À payer avant : 08/10 » while the PDF said 02/11); a devis printed after its validity says
// « (expiré) » — amended 2026-10-19: never on the guest's document (specs/ui-review-2026-10-19-operations.md
// rule 20); the HT column of the PDF holds the line total (mega review #5, m2 and m3).
const devisModel = require('../models/devisModel');
const { FR, EN } = require('../utils/devisPdfLabels');

const DDL = `
  CREATE TABLE properties (
    id INTEGER PRIMARY KEY, name TEXT,
    defaultCheckIn TEXT, defaultCheckOut TEXT, defaultCautionAmount REAL,
    depositPercent REAL, depositDaysBefore INTEGER, balanceDaysBefore INTEGER,
    minNights INTEGER, basePrice REAL
  );
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
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id, quoteValidityDays) VALUES (1, 15)').run();
  db.prepare("INSERT INTO properties (id, name, depositPercent, balanceDaysBefore) VALUES (1, 'Maison test', 0, 30)").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 120, 1)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.generateDevisNumber = () => 'D-TEST-002';
  return { model: devisModel.buildModel(db), db };
}

const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test('rule 17 — saving an expired devis re-issues it and its single payment follows the new validity', () => {
  const { model, db } = freshModel();
  const stay = { propertyId: 1, clientId: 1, startDate: plusDays(90), endDate: plusDays(93), adults: 2, platform: 'direct' };
  const created = model.create(stay);
  const id = created.data.id;
  db.prepare("UPDATE reservations SET validUntil = ?, balanceDueDate = ?, createdAt = ? WHERE id = ?")
    .run(plusDays(-11), plusDays(-10), `${plusDays(-26)} 10:00:00`, id);
  model.update(id, stay);
  const row = db.prepare('SELECT validUntil, depositAmount, balanceDueDate FROM reservations WHERE id = ?').get(id);
  assert.ok(row.validUntil >= plusDays(0), 'a new validity window from today');
  assert.equal(Number(row.depositAmount || 0), 0);
  assert.equal(row.balanceDueDate, row.validUntil, 'the fiche and the PDF read the same date');
});

// specs/devis-pdf-and-tourist-tax-fixes.md rule 21 — amended 2026-10-19: the expiry is no longer printed.
test('rule 21 — the expiry is no longer printed: the labels carry no « (expiré) » suffix', () => {
  assert.equal(FR.expiredSuffix, undefined);
  assert.equal(EN.expiredSuffix, undefined);
});

// specs/devis-pdf-and-tourist-tax-fixes.md rule 22
test('rule 22 — the HT column is named for what it holds: the line total', () => {
  assert.equal(FR.colUnitPriceHt, 'Total HT');
  assert.equal(EN.colUnitPriceHt, 'Total excl. VAT');
});
