const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');

// Non-regression guard for the legacy bug where some devis rows ended up with
// `createdAt = ''` and `validUntil = NULL`, breaking the PDF "Date du devis" pill and
// making "Valable jusqu'au" ignore the operator's configured quoteValidityDays
// (specs/devis-pdf-and-tourist-tax-fixes.md §3.1 + §3.2).

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

function freshModel({ quoteValidityDays = 30 } = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id, quoteValidityDays) VALUES (1, ?)').run(quoteValidityDays);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Maison test')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 120, 1)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.generateDevisNumber = () => 'D-TEST-001';
  return { model: devisModel.buildModel(db), db };
}

const todayDate = () => new Date().toISOString().slice(0, 10);

test('create persists a non-empty createdAt (rule 1, never blank)', () => {
  const { model, db } = freshModel();
  const result = model.create({
    propertyId: 1, clientId: 1, startDate: '2026-09-10', endDate: '2026-09-12', adults: 2,
  });
  const row = db.prepare("SELECT createdAt, length(coalesce(createdAt,'')) AS len FROM reservations WHERE id = ?").get(result.data.id);
  assert.ok(row.len > 0, 'createdAt must not be empty');
  assert.equal(row.createdAt.slice(0, 10), todayDate());
});

test('create persists validUntil = createdAt + quoteValidityDays (rule 6)', () => {
  const { model, db } = freshModel({ quoteValidityDays: 14 });
  const result = model.create({
    propertyId: 1, clientId: 1, startDate: '2026-12-10', endDate: '2026-12-12', adults: 2,
  });
  const row = db.prepare('SELECT validUntil FROM reservations WHERE id = ?').get(result.data.id);
  const expected = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  assert.equal(row.validUntil, expected);
});

test('create caps validUntil at startDate - 2 days (rule 6 cap)', () => {
  // quoteValidityDays = 90 but startDate is in 5 days → cap forces validUntil = start - 2.
  const { model, db } = freshModel({ quoteValidityDays: 90 });
  const startDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const result = model.create({ propertyId: 1, clientId: 1, startDate, endDate, adults: 2 });
  const row = db.prepare('SELECT validUntil FROM reservations WHERE id = ?').get(result.data.id);
  const expectedCap = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10); // start - 2
  assert.equal(row.validUntil, expectedCap);
});

test('update fills missing validUntil on a legacy row (rule 7)', () => {
  const { model, db } = freshModel({ quoteValidityDays: 21 });
  const created = model.create({
    propertyId: 1, clientId: 1, startDate: '2027-01-15', endDate: '2027-01-17', adults: 2,
  });
  // Simulate a legacy row whose validUntil column was never set.
  db.prepare('UPDATE reservations SET validUntil = NULL WHERE id = ?').run(created.data.id);

  model.update(created.data.id, {
    propertyId: 1, clientId: 1, startDate: '2027-01-15', endDate: '2027-01-17', adults: 2,
  });
  const row = db.prepare('SELECT validUntil FROM reservations WHERE id = ?').get(created.data.id);
  // The update path recomputes from existing.createdAt + quoteValidityDays.
  const createdAt = db.prepare('SELECT createdAt FROM reservations WHERE id = ?').get(created.data.id).createdAt;
  const expected = new Date(new Date(createdAt.slice(0, 10) + 'T00:00:00Z').getTime() + 21 * 86400000).toISOString().slice(0, 10);
  assert.equal(row.validUntil, expected);
});

test('update preserves an explicit payload validUntil', () => {
  const { model, db } = freshModel();
  const created = model.create({
    propertyId: 1, clientId: 1, startDate: '2026-09-10', endDate: '2026-09-12', adults: 2,
  });
  model.update(created.data.id, {
    propertyId: 1, clientId: 1, startDate: '2026-09-10', endDate: '2026-09-12', adults: 2,
    validUntil: '2026-08-31',
  });
  const row = db.prepare('SELECT validUntil FROM reservations WHERE id = ?').get(created.data.id);
  assert.equal(row.validUntil, '2026-08-31');
});

test('convertFromReservation persists createdAt + validUntil on the new devis row', () => {
  const { model, db } = freshModel({ quoteValidityDays: 30 });
  const startDate = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 62 * 86400000).toISOString().slice(0, 10);
  const insert = db.prepare(`
    INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, totalPrice, finalPrice, touristTaxRate, touristTaxTotal)
    VALUES ('reservation', 1, 1, ?, ?, 2, 240, 240, 0, 0)
  `).run(startDate, endDate);
  const reservationId = Number(insert.lastInsertRowid);

  const result = model.convertFromReservation(reservationId);
  const row = db.prepare('SELECT createdAt, validUntil FROM reservations WHERE id = ?').get(result.data.id);
  assert.ok(row.createdAt && row.createdAt.length > 0);
  assert.equal(row.createdAt.slice(0, 10), todayDate());
  const expected = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  assert.equal(row.validUntil, expected);
});
