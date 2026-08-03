// One-shot migration: the arrival SAS's « Ménage » / « Linge de toilette » custom lines move onto
// their catalogue option. See specs/sas-upsells-activate-catalogue-option.md §3.4.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runSasUpsellOptionMigration } = require('../utils/sasUpsellOptionMigration');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY, kind TEXT DEFAULT 'reservation', propertyId INTEGER,
      adults INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, children INTEGER DEFAULT 0
    );
    CREATE TABLE reservation_nights (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, date TEXT);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, autoOptionType TEXT, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay');
    CREATE TABLE reservation_options (
      reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL, quantity REAL DEFAULT 1,
      unitPrice REAL DEFAULT 0, billedUnits REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay',
      totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0,
      sasArrivalOrigin INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (reservationId, optionId)
    );
    CREATE TABLE reservation_custom_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0,
      inComplement INTEGER DEFAULT 0, sasArrivalOrigin INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare("INSERT INTO options (id, title, autoOptionType, price, priceType) VALUES (50, 'Ménage', 'cleaning', 40, 'per_stay')").run();
  db.prepare("INSERT INTO options (id, title, autoOptionType, price, priceType) VALUES (60, 'Linge de toilette', 'bathroom_linen', 8, 'per_person')").run();
  db.prepare('INSERT INTO reservations (id, propertyId, adults, children) VALUES (1, 7, 2, 2)').run();
  return db;
}

const addCustom = (db, description, amount, sasOrigin = 1, reservationId = 1) =>
  db.prepare('INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement, sasArrivalOrigin) VALUES (?, ?, ?, 1, ?)')
    .run(reservationId, description, amount, sasOrigin);

test('moves a SAS bath-linen custom line onto its catalogue option, at the SAME amount', () => {
  const db = freshDb();
  addCustom(db, 'Linge de toilette', 32);

  const { migrated, skipped } = runSasUpsellOptionMigration(db);
  assert.equal(migrated, 1);
  assert.deepEqual(skipped, []);

  const row = db.prepare('SELECT * FROM reservation_options WHERE reservationId = 1 AND optionId = 60').get();
  assert.equal(row.totalPrice, 32, 'a past stay is never re-quoted');
  assert.equal(row.billedUnits, 4, '4 persons');
  assert.equal(row.unitPrice, 8);
  assert.equal(row.inComplement, 1);
  assert.equal(row.sasArrivalOrigin, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservation_custom_options WHERE reservationId = 1').get().n, 0);
});

test('the amount owed is invariant — Σ(custom) + Σ(options) is unchanged', () => {
  const db = freshDb();
  addCustom(db, 'Ménage', 40);
  addCustom(db, 'Linge de toilette', 32);
  const total = (d) => d.prepare(`
    SELECT (SELECT COALESCE(SUM(amount), 0) FROM reservation_custom_options WHERE reservationId = 1)
         + (SELECT COALESCE(SUM(totalPrice), 0) FROM reservation_options WHERE reservationId = 1) AS t
  `).get().t;

  const before = total(db);
  runSasUpsellOptionMigration(db);
  assert.equal(total(db), before);
  assert.equal(before, 72);
});

test('matches the cleaning by name (an untagged « ménage » line still migrates)', () => {
  const db = freshDb();
  addCustom(db, 'Menage', 40);          // no accent, as typed
  assert.equal(runSasUpsellOptionMigration(db).migrated, 1);
  assert.ok(db.prepare('SELECT 1 FROM reservation_options WHERE reservationId = 1 AND optionId = 50').get());
});

test('leaves the linen elements and the operator lines alone', () => {
  const db = freshDb();
  addCustom(db, "Taie d'oreiller", 5);            // SAS, but not a catalogue upsell
  addCustom(db, 'Linge de toilette', 32, 0);      // operator line (no SAS marker)

  assert.equal(runSasUpsellOptionMigration(db).migrated, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservation_custom_options WHERE reservationId = 1').get().n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservation_options WHERE reservationId = 1').get().n, 0);
});

test('skips (and reports) a reservation that already carries the option — never lowers what is owed', () => {
  const db = freshDb();
  addCustom(db, 'Linge de toilette', 32);
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, totalPrice) VALUES (1, 60, 32)').run();

  const { migrated, skipped } = runSasUpsellOptionMigration(db);
  assert.equal(migrated, 0);
  assert.deepEqual(skipped, [1]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservation_custom_options WHERE reservationId = 1').get().n, 1, 'custom line kept');
});

test('idempotent — a second run moves nothing', () => {
  const db = freshDb();
  addCustom(db, 'Ménage', 40);
  assert.equal(runSasUpsellOptionMigration(db).migrated, 1);
  assert.equal(runSasUpsellOptionMigration(db).migrated, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservation_options WHERE reservationId = 1').get().n, 1);
});

test('minimal schema without the catalogue options → no-op', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)');
  assert.deepEqual(runSasUpsellOptionMigration(db), { migrated: 0, skipped: [] });
});
