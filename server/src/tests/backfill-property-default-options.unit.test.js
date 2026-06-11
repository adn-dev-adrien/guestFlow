// Backfill migration: applies property default options to existing reservations that lack them.
// See specs/property-default-option-applicability.md §5.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runBackfillPropertyDefaultOptionsMigration } = require('../utils/backfillPropertyDefaultOptionsMigration');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT DEFAULT 'per_stay');
    CREATE TABLE property_option_defaults (propertyId INTEGER, optionId INTEGER, offered INTEGER DEFAULT 0, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, propertyId INTEGER, kind TEXT DEFAULT 'reservation');
    CREATE TABLE reservation_options (
      reservationId INTEGER, optionId INTEGER, quantity REAL DEFAULT 1, unitPrice REAL DEFAULT 0,
      billedUnits REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', totalPrice REAL DEFAULT 0,
      offered INTEGER DEFAULT 0, PRIMARY KEY (reservationId, optionId)
    );
  `);
  return db;
}

test('inserts the offered default onto a reservation that lacks it (0 €, offered, priceType from option)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO options (id, title, priceType) VALUES (8, 'Linge', 'per_person')").run();
  db.prepare("INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 8, 1)").run();
  db.prepare("INSERT INTO reservations (id, propertyId, kind) VALUES (100, 1, 'reservation')").run();

  const { insertedCount } = runBackfillPropertyDefaultOptionsMigration(db);
  assert.equal(insertedCount, 1);
  const row = db.prepare('SELECT * FROM reservation_options WHERE reservationId=100 AND optionId=8').get();
  assert.equal(row.offered, 1);
  assert.equal(row.totalPrice, 0);
  assert.equal(row.priceType, 'per_person');
});

test('idempotent: skips an already-attached option and never duplicates or overwrites it', () => {
  const db = freshDb();
  db.prepare("INSERT INTO options (id, title, priceType) VALUES (8, 'Linge', 'per_person')").run();
  db.prepare("INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 8, 1)").run();
  db.prepare("INSERT INTO reservations (id, propertyId, kind) VALUES (100, 1, 'reservation')").run();
  // Already attached (e.g. a recent iCal import) with a real billed price — must stay untouched.
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, totalPrice, offered) VALUES (100, 8, 14, 0)").run();

  assert.equal(runBackfillPropertyDefaultOptionsMigration(db).insertedCount, 0);
  assert.equal(runBackfillPropertyDefaultOptionsMigration(db).insertedCount, 0); // second run = no-op
  const rows = db.prepare('SELECT totalPrice, offered FROM reservation_options WHERE reservationId=100 AND optionId=8').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalPrice, 14);
  assert.equal(rows[0].offered, 0);
});

test('only touches the default\'s own property and kind=reservation (devis + other properties untouched)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO options (id, title) VALUES (8, 'Linge')").run();
  db.prepare("INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 8, 1)").run();
  db.prepare("INSERT INTO reservations (id, propertyId, kind) VALUES (100, 1, 'reservation')").run(); // Gîte
  db.prepare("INSERT INTO reservations (id, propertyId, kind) VALUES (101, 2, 'reservation')").run(); // other property
  db.prepare("INSERT INTO reservations (id, propertyId, kind) VALUES (102, 1, 'devis')").run();        // devis → skipped

  assert.equal(runBackfillPropertyDefaultOptionsMigration(db).insertedCount, 1);
  assert.ok(db.prepare('SELECT 1 FROM reservation_options WHERE reservationId=100').get());
  assert.equal(db.prepare('SELECT 1 FROM reservation_options WHERE reservationId=101').get(), undefined);
  assert.equal(db.prepare('SELECT 1 FROM reservation_options WHERE reservationId=102').get(), undefined);
});

test('honours the configured offered flag (chargeable default inserted with offered=0)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO options (id, title) VALUES (5, 'Ménage')").run();
  db.prepare("INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 5, 0)").run();
  db.prepare("INSERT INTO reservations (id, propertyId, kind) VALUES (100, 1, 'reservation')").run();

  runBackfillPropertyDefaultOptionsMigration(db);
  assert.equal(db.prepare('SELECT offered FROM reservation_options WHERE reservationId=100 AND optionId=5').get().offered, 0);
});

test('no-op when the property has no defaults', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (id, propertyId, kind) VALUES (100, 1, 'reservation')").run();
  assert.equal(runBackfillPropertyDefaultOptionsMigration(db).insertedCount, 0);
});
