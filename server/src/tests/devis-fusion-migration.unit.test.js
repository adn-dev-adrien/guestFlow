const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { migrateDevisIntoReservations } = require('../utils/devisFusionMigration');

// reservations already carries the post-fusion columns; legacy devis_* still present.
const DDL = `
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'reservation',
    devisNumber TEXT, devisStatus TEXT, validUntil TEXT, convertedReservationId INTEGER,
    propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT,
    adults INTEGER, children INTEGER, teens INTEGER, babies INTEGER,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER, checkInTime TEXT, checkOutTime TEXT, platform TEXT,
    totalPrice REAL, touristTaxRate REAL, touristTaxTotal REAL, discountPercent REAL, customPrice REAL, finalPrice REAL,
    depositAmount REAL, depositDueDate TEXT, depositPaid INTEGER DEFAULT 0,
    balanceAmount REAL, balanceDueDate TEXT, balancePaid INTEGER DEFAULT 0,
    cautionAmount REAL, notes TEXT, createdAt TEXT, updatedAt TEXT
  );
  CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER, PRIMARY KEY (reservationId, optionId));
  CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL, offered INTEGER, sortOrder INTEGER, createdAt TEXT, updatedAt TEXT);
  CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, quantity INTEGER, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER, PRIMARY KEY (reservationId, resourceId));
  CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL, PRIMARY KEY (reservationId, date));
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT, createdAt TEXT);

  CREATE TABLE devis (
    id INTEGER PRIMARY KEY AUTOINCREMENT, devisNumber TEXT, propertyId INTEGER, clientId INTEGER, status TEXT,
    startDate TEXT, endDate TEXT, adults INTEGER, children INTEGER, teens INTEGER, babies INTEGER,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER, checkInTime TEXT, checkOutTime TEXT, platform TEXT,
    totalPrice REAL, touristTaxRate REAL, touristTaxTotal REAL, discountPercent REAL, customPrice REAL, finalPrice REAL,
    depositAmount REAL, depositDueDate TEXT, balanceAmount REAL, balanceDueDate TEXT, cautionAmount REAL,
    notes TEXT, validUntil TEXT, convertedReservationId INTEGER, createdAt TEXT, updatedAt TEXT
  );
  CREATE TABLE devis_options (devisId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER, PRIMARY KEY (devisId, optionId));
  CREATE TABLE devis_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, devisId INTEGER, description TEXT, amount REAL, offered INTEGER, sortOrder INTEGER, createdAt TEXT, updatedAt TEXT);
  CREATE TABLE devis_resources (devisId INTEGER, resourceId INTEGER, quantity INTEGER, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL, offered INTEGER, PRIMARY KEY (devisId, resourceId));
  CREATE TABLE devis_nights (devisId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL, PRIMARY KEY (devisId, date));
  CREATE TABLE devis_history (id INTEGER PRIMARY KEY AUTOINCREMENT, devisId INTEGER, eventType TEXT, changedFields TEXT, createdAt TEXT);
`;

function seed() {
  const db = new Database(':memory:');
  db.exec(DDL);
  // An existing reservation (must be left untouched by the migration).
  db.prepare("INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, finalPrice) VALUES (500, 'reservation', 1, 1, '2026-07-01', '2026-07-04', 360)").run();
  // Two devis: one draft, one converted (links to reservation 500).
  db.prepare(`INSERT INTO devis (id, devisNumber, propertyId, clientId, status, startDate, endDate, adults, children, teens, babies, checkInTime, checkOutTime, platform, totalPrice, finalPrice, depositAmount, balanceAmount, cautionAmount, notes, validUntil, convertedReservationId, createdAt, updatedAt)
    VALUES (1, 'D-2026-001', 1, 1, 'draft', '2026-08-10', '2026-08-13', 2, 0, 0, 0, '15:00', '10:00', 'direct', 360, 410, 123, 287, 500, 'note A', '2026-08-01', NULL, '2026-05-01 10:00:00', '2026-05-01 10:00:00')`).run();
  db.prepare(`INSERT INTO devis (id, devisNumber, propertyId, clientId, status, startDate, endDate, adults, children, teens, babies, checkInTime, checkOutTime, platform, totalPrice, finalPrice, depositAmount, balanceAmount, cautionAmount, notes, validUntil, convertedReservationId, createdAt, updatedAt)
    VALUES (2, 'D-2026-002', 1, 1, 'converted', '2026-07-01', '2026-07-04', 2, 0, 0, 0, '15:00', '10:00', 'direct', 360, 360, 108, 252, 500, 'note B', NULL, 500, '2026-05-02 10:00:00', '2026-05-02 10:00:00')`).run();
  db.prepare("INSERT INTO devis_options (devisId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered) VALUES (1, 9, 1, 50, 1, 'per_stay', 50, 0)").run();
  db.prepare("INSERT INTO devis_custom_options (devisId, description, amount, offered, sortOrder) VALUES (1, 'Extra', 30, 0, 0)").run();
  db.prepare("INSERT INTO devis_resources (devisId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered) VALUES (1, 3, 1, 20, 6, 'per_person_per_night', 120, 0)").run();
  db.prepare("INSERT INTO devis_nights (devisId, date, seasonLabel, pricingMode, price) VALUES (1, '2026-08-10', 'Standard', 'fixed', 120)").run();
  db.prepare("INSERT INTO devis_history (devisId, eventType, changedFields, createdAt) VALUES (1, 'create', '[]', '2026-05-01 10:00:00')").run();
  return db;
}

test('migrates every devis into reservations(kind=devis) with fields + children + history preserved', () => {
  const db = seed();
  const result = migrateDevisIntoReservations(db);
  assert.equal(result.skipped, false);
  assert.equal(result.devis, 2);

  const fused = db.prepare("SELECT * FROM reservations WHERE kind = 'devis' ORDER BY devisNumber").all();
  assert.equal(fused.length, 2);
  const d1 = fused[0];
  assert.equal(d1.devisNumber, 'D-2026-001');
  assert.equal(d1.devisStatus, 'draft');
  assert.equal(d1.validUntil, '2026-08-01');
  assert.equal(d1.finalPrice, 410);
  assert.equal(d1.cautionAmount, 500);
  assert.equal(d1.depositPaid, 0); // reservation-only default

  // children moved onto the new reservation id
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_options WHERE reservationId = ?').get(d1.id).c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_custom_options WHERE reservationId = ?').get(d1.id).c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_resources WHERE reservationId = ?').get(d1.id).c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservation_nights WHERE reservationId = ?').get(d1.id).c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM reservation_history WHERE reservationId = ? AND eventType = 'create'").get(d1.id).c, 1);

  // converted devis keeps its link
  const d2 = fused[1];
  assert.equal(d2.devisStatus, 'converted');
  assert.equal(d2.convertedReservationId, 500);
});

test('leaves the existing reservation untouched and drops the devis tables', () => {
  const db = seed();
  migrateDevisIntoReservations(db);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM reservations WHERE kind = 'reservation'").get().c, 1);
  for (const t of ['devis', 'devis_options', 'devis_custom_options', 'devis_resources', 'devis_nights', 'devis_history']) {
    assert.equal(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name = ?").get(t).c, 0, `${t} should be dropped`);
  }
});

test('is idempotent: a second run is a no-op (devis table gone)', () => {
  const db = seed();
  migrateDevisIntoReservations(db);
  const again = migrateDevisIntoReservations(db);
  assert.equal(again.skipped, true);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM reservations WHERE kind = 'devis'").get().c, 2);
});
