const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runZeroBedsWhenNoBedLinenMigration } = require('../utils/zeroBedsWhenNoBedLinenMigration');

// specs/bed-config-in-linen-card.md §5 + §7.1. Plain :memory: fixture with the 4 tables the
// migration touches. The migration zeroes bed counts on reservations that have neither an
// explicit bed-linen-flagged option in reservation_options nor a bed-linen-flagged option
// declared as a default on their property.

const DDL = `
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'reservation',
    propertyId INTEGER,
    singleBeds INTEGER,
    doubleBeds INTEGER,
    babyBeds INTEGER
  );
  CREATE TABLE options (
    id INTEGER PRIMARY KEY,
    countsAsBedLinen INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE reservation_options (
    reservationId INTEGER NOT NULL,
    optionId INTEGER NOT NULL,
    PRIMARY KEY (reservationId, optionId)
  );
  CREATE TABLE property_option_defaults (
    propertyId INTEGER NOT NULL,
    optionId INTEGER NOT NULL,
    PRIMARY KEY (propertyId, optionId)
  );
`;

function freshDb() {
  const db = new Database(':memory:');
  db.exec(DDL);
  // Options catalog: id=1 is bed-linen-flagged, id=2 is a regular non-linen option.
  db.prepare('INSERT INTO options (id, countsAsBedLinen) VALUES (1, 1)').run();
  db.prepare('INSERT INTO options (id, countsAsBedLinen) VALUES (2, 0)').run();
  return db;
}

test('reservation WITH bed-linen option in reservation_options → counts untouched', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (id, kind, propertyId, singleBeds, doubleBeds, babyBeds) VALUES (10, 'reservation', 100, 2, 1, 1)").run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId) VALUES (10, 1)').run();

  const result = runZeroBedsWhenNoBedLinenMigration(db);
  assert.equal(result.zeroedCount, 0);

  const row = db.prepare('SELECT singleBeds, doubleBeds, babyBeds FROM reservations WHERE id = 10').get();
  assert.deepEqual(row, { singleBeds: 2, doubleBeds: 1, babyBeds: 1 });
});

test('reservation WITHOUT bed-linen option, on a property declaring bed-linen as a default → counts untouched', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (id, kind, propertyId, singleBeds, doubleBeds, babyBeds) VALUES (20, 'reservation', 200, 3, 2, 0)").run();
  // No row in reservation_options for #20 — but the property declares bed-linen as a default.
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId) VALUES (200, 1)').run();

  const result = runZeroBedsWhenNoBedLinenMigration(db);
  assert.equal(result.zeroedCount, 0);

  const row = db.prepare('SELECT singleBeds, doubleBeds, babyBeds FROM reservations WHERE id = 20').get();
  assert.deepEqual(row, { singleBeds: 3, doubleBeds: 2, babyBeds: 0 });
});

test('reservation WITHOUT bed-linen option AND no property default → counts zeroed', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (id, kind, propertyId, singleBeds, doubleBeds, babyBeds) VALUES (30, 'reservation', 300, 4, 3, 2)").run();
  // No reservation_options row, no property default — only a non-linen option attached.
  db.prepare('INSERT INTO reservation_options (reservationId, optionId) VALUES (30, 2)').run();

  const result = runZeroBedsWhenNoBedLinenMigration(db);
  assert.equal(result.zeroedCount, 1);

  const row = db.prepare('SELECT singleBeds, doubleBeds, babyBeds FROM reservations WHERE id = 30').get();
  assert.deepEqual(row, { singleBeds: 0, doubleBeds: 0, babyBeds: 0 });
});

test('migration is idempotent — second run touches 0 rows', () => {
  const db = freshDb();
  // 2 reservations: one with bed-linen (kept), one without (zeroed on first run).
  db.prepare("INSERT INTO reservations (id, kind, propertyId, singleBeds, doubleBeds, babyBeds) VALUES (40, 'reservation', 400, 2, 1, 1)").run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId) VALUES (40, 1)').run();
  db.prepare("INSERT INTO reservations (id, kind, propertyId, singleBeds, doubleBeds, babyBeds) VALUES (41, 'reservation', 401, 3, 2, 1)").run();

  const first = runZeroBedsWhenNoBedLinenMigration(db);
  assert.equal(first.zeroedCount, 1);

  const second = runZeroBedsWhenNoBedLinenMigration(db);
  assert.equal(second.zeroedCount, 0, 'second run must be a no-op — already-zero rows do not re-match');

  // The kept row is still intact.
  const kept = db.prepare('SELECT singleBeds, doubleBeds, babyBeds FROM reservations WHERE id = 40').get();
  assert.deepEqual(kept, { singleBeds: 2, doubleBeds: 1, babyBeds: 1 });
});

test('devis (kind = "devis") are skipped — only reservations are zeroed', () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (id, kind, propertyId, singleBeds, doubleBeds, babyBeds) VALUES (50, 'devis', 500, 5, 3, 2)").run();

  const result = runZeroBedsWhenNoBedLinenMigration(db);
  assert.equal(result.zeroedCount, 0);

  const row = db.prepare('SELECT singleBeds, doubleBeds, babyBeds FROM reservations WHERE id = 50').get();
  assert.deepEqual(row, { singleBeds: 5, doubleBeds: 3, babyBeds: 2 });
});
