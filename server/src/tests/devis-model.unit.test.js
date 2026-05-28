const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const devisModel = require('../models/devisModel');

const DDL = `
  CREATE TABLE properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
    defaultCautionAmount REAL DEFAULT 0, vatPercentageAccommodation REAL DEFAULT 20, vatPercentageOptions REAL DEFAULT 20,
    vatPercentageResources REAL DEFAULT 20, depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 0, balanceDaysBefore INTEGER DEFAULT 0
  );
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, phone TEXT, address TEXT, email TEXT);
  CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, priceType TEXT, price REAL, autoOptionType TEXT, autoFullNightThreshold TEXT);
  CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, priceType TEXT, price REAL);
  CREATE TABLE devis (
    id INTEGER PRIMARY KEY AUTOINCREMENT, devisNumber TEXT, propertyId INTEGER, clientId INTEGER, status TEXT DEFAULT 'draft',
    startDate TEXT, endDate TEXT, adults INTEGER DEFAULT 1, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER, checkInTime TEXT, checkOutTime TEXT, platform TEXT,
    totalPrice REAL DEFAULT 0, touristTaxRate REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0, discountPercent REAL DEFAULT 0,
    customPrice REAL, finalPrice REAL DEFAULT 0, depositAmount REAL DEFAULT 0, depositDueDate TEXT, balanceAmount REAL DEFAULT 0,
    balanceDueDate TEXT, cautionAmount REAL DEFAULT 0, notes TEXT, validUntil TEXT, convertedReservationId INTEGER,
    createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE devis_options (id INTEGER PRIMARY KEY AUTOINCREMENT, devisId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE devis_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, devisId INTEGER, description TEXT, amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0);
  CREATE TABLE devis_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, devisId INTEGER, resourceId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE devis_nights (devisId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL);
  CREATE TABLE devis_history (id INTEGER PRIMARY KEY AUTOINCREMENT, devisId INTEGER, eventType TEXT, changedFields TEXT, createdAt TEXT DEFAULT (datetime('now')));
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT,
    adults INTEGER, children INTEGER, teens INTEGER, babies INTEGER, singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER,
    checkInTime TEXT, checkOutTime TEXT, platform TEXT, totalPrice REAL, touristTaxRate REAL, touristTaxTotal REAL,
    discountPercent REAL, customPrice REAL, finalPrice REAL, depositAmount REAL, depositDueDate TEXT, depositPaid INTEGER DEFAULT 0,
    balanceAmount REAL, balanceDueDate TEXT, balancePaid INTEGER DEFAULT 0, cautionAmount REAL, notes TEXT, sourceType TEXT
  );
  CREATE TABLE reservation_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0);
  CREATE TABLE reservation_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, resourceId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0);
  CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL);
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT, createdAt TEXT);
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.generateDevisNumber = () => 'D-TEST-001';
  db.prepare('INSERT INTO properties (id, name, depositPercent) VALUES (1, ?, 30)').run('Villa A');
  db.prepare('INSERT INTO clients (id, firstName, lastName, phone) VALUES (1, ?, ?, ?)').run('Jean', 'Dupont', '0612345678');
  db.prepare('INSERT INTO options (id, title, priceType, price) VALUES (1, ?, ?, ?)').run('Ménage', 'per_stay', 80);
  db.prepare('INSERT INTO resources (id, name, priceType, price) VALUES (1, ?, ?, ?)').run('Vélo', 'per_stay', 10);
  return { model: devisModel.buildModel(db), db };
}

function insertDevis(db, overrides = {}) {
  const d = {
    devisNumber: 'D-1', propertyId: 1, clientId: 1, status: 'draft', startDate: '2099-06-01', endDate: '2099-06-04',
    finalPrice: 400, touristTaxTotal: 30, ...overrides,
  };
  const info = db.prepare(`
    INSERT INTO devis (devisNumber, propertyId, clientId, status, startDate, endDate, finalPrice, touristTaxTotal)
    VALUES (@devisNumber, @propertyId, @clientId, @status, @startDate, @endDate, @finalPrice, @touristTaxTotal)
  `).run(d);
  return Number(info.lastInsertRowid);
}

test('findById enriches with lines, client, property and payment schedule', () => {
  const { model, db } = freshModel();
  const id = insertDevis(db);
  db.prepare('INSERT INTO devis_options (devisId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (?, 1, 1, 80, 1, ?, 80)').run(id, 'per_stay');
  db.prepare('INSERT INTO devis_custom_options (devisId, description, amount, sortOrder) VALUES (?, ?, 25, 0)').run(id, 'Extra');
  db.prepare('INSERT INTO devis_resources (devisId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (?, 1, 1, 10, 1, ?, 10)').run(id, 'per_stay');
  db.prepare('INSERT INTO devis_nights (devisId, date, seasonLabel, pricingMode, price) VALUES (?, ?, ?, ?, ?)').run(id, '2099-06-01', 'Standard', 'fixed', 100);

  const full = model.findById(id);
  assert.equal(full.options.length, 2); // option + custom option
  assert.equal(full.resources.length, 1);
  assert.equal(full.nights.length, 1);
  assert.equal(full.client.firstName, 'Jean');
  assert.equal(full.property.name, 'Villa A');
  // schedule: (400 + 30) * 30% = 129 deposit
  assert.equal(full.depositAmount, 129);
  assert.equal(full.balanceAmount, 301);
  assert.equal(model.findById(9999), null);
});

test('updateStatus validates, records history, and blocks converted devis', () => {
  const { model, db } = freshModel();
  const id = insertDevis(db);
  const res = model.updateStatus(id, 'sent');
  assert.equal(res.ok, true);
  assert.equal(res.data.status, 'sent');
  assert.equal(model.getHistory(id).length, 1); // status change recorded

  assert.equal(model.updateStatus(id, 'bogus').status, 400);
  assert.equal(model.updateStatus(9999, 'sent').status, 404);

  db.prepare("UPDATE devis SET status = 'converted' WHERE id = ?").run(id);
  assert.equal(model.updateStatus(id, 'sent').status, 400);
});

test('remove deletes / 404', () => {
  const { model, db } = freshModel();
  const id = insertDevis(db);
  assert.equal(model.remove(9999).status, 404);
  assert.equal(model.remove(id).ok, true);
  assert.equal(model.findById(id), null);
});

test('convertToReservation copies lines, marks converted, blocks double conversion', () => {
  const { model, db } = freshModel();
  const id = insertDevis(db);
  db.prepare('INSERT INTO devis_options (devisId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (?, 1, 1, 80, 1, ?, 80)').run(id, 'per_stay');
  db.prepare('INSERT INTO devis_resources (devisId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (?, 1, 1, 10, 1, ?, 10)').run(id, 'per_stay');
  db.prepare('INSERT INTO devis_history (devisId, eventType, changedFields) VALUES (?, ?, ?)').run(id, 'create', '[]');

  const result = model.convertToReservation(id);
  assert.equal(result.ok, true);
  const reservationId = result.data.reservationId;
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_options WHERE reservationId = ?').get(reservationId).c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_resources WHERE reservationId = ?').get(reservationId).c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_history WHERE reservationId = ?').get(reservationId).c, 1);
  const devisRow = db.prepare('SELECT status, convertedReservationId FROM devis WHERE id = ?').get(id);
  assert.equal(devisRow.status, 'converted');
  assert.equal(devisRow.convertedReservationId, reservationId);

  assert.equal(model.convertToReservation(id).status, 400); // already converted
});

test('convertFromReservation creates a devis copying the reservation lines', () => {
  const { model, db } = freshModel();
  const rid = db.prepare('INSERT INTO reservations (propertyId, clientId, startDate, endDate, finalPrice) VALUES (1, 1, ?, ?, 400)').run('2099-06-01', '2099-06-04').lastInsertRowid;
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (?, 1, 1, 80, 1, ?, 80)').run(rid, 'per_stay');
  db.prepare('INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, ?, ?, ?)').run(rid, '2099-06-01', 'Standard', 'fixed', 100);

  const result = model.convertFromReservation(rid);
  assert.equal(result.status, 201);
  assert.equal(result.data.devisNumber, 'D-TEST-001');
  assert.equal(result.data.options.length, 1);
  assert.equal(result.data.nights.length, 1);
});
