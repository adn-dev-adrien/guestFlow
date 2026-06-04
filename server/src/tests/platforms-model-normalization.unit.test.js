const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runPlatformNamesNormalization } = require('../utils/normalizePlatformNamesMigration');

// specs/normalize-platform-names.md §3.3 + §7.1.
// Drives the one-shot migration through a plain :memory: SQLite fixture, mirroring the
// three tables the production migration walks.

const DDL = `
  CREATE TABLE ical_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platformLabel TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT
  );
  CREATE TABLE platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    commissionAccountNumber TEXT,
    hasVatOnCommission INTEGER NOT NULL DEFAULT 0
  );
`;

function fresh() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return db;
}

test('merge: two casing-different platforms collapse, winner has non-NULL commission account', () => {
  const db = fresh();
  // Loser first (id 1, no account), winner second (id 2, has account).
  db.prepare("INSERT INTO platforms (name, commissionAccountNumber, hasVatOnCommission) VALUES ('gitedefrance', NULL, 0)").run();
  db.prepare("INSERT INTO platforms (name, commissionAccountNumber, hasVatOnCommission) VALUES ('Gitedefrance', '62260500', 1)").run();
  db.prepare("INSERT INTO ical_sources (platformLabel) VALUES ('gitedefrance')").run();
  db.prepare("INSERT INTO ical_sources (platformLabel) VALUES ('Gitedefrance')").run();
  db.prepare("INSERT INTO reservations (platform) VALUES ('gitedefrance')").run();
  db.prepare("INSERT INTO reservations (platform) VALUES ('Gitedefrance')").run();

  const { mergedCount, renamedCount } = runPlatformNamesNormalization(db);
  assert.equal(mergedCount, 1, 'one merge expected');
  assert.equal(renamedCount, 0, 'winner was already canonical');

  // Only one platform row left, and it's the one with the account configured.
  const platforms = db.prepare('SELECT name, commissionAccountNumber FROM platforms').all();
  assert.equal(platforms.length, 1);
  assert.equal(platforms[0].name, 'Gitedefrance');
  assert.equal(platforms[0].commissionAccountNumber, '62260500');

  // Both iCal source labels and both reservation rows now point to the canonical name.
  const icalLabels = db.prepare('SELECT platformLabel FROM ical_sources ORDER BY id').all().map((r) => r.platformLabel);
  assert.deepEqual(icalLabels, ['Gitedefrance', 'Gitedefrance']);
  const resPlatforms = db.prepare('SELECT platform FROM reservations ORDER BY id').all().map((r) => r.platform);
  assert.deepEqual(resPlatforms, ['Gitedefrance', 'Gitedefrance']);
});

test('merge: winner = lowest id when neither row has a commission account', () => {
  const db = fresh();
  db.prepare("INSERT INTO platforms (name) VALUES ('lodgify')").run();   // id 1, winner (no account, lowest id)
  db.prepare("INSERT INTO platforms (name) VALUES ('Lodgify')").run();   // id 2, loser
  db.prepare("INSERT INTO reservations (platform) VALUES ('lodgify')").run();
  db.prepare("INSERT INTO reservations (platform) VALUES ('Lodgify')").run();

  const { mergedCount, renamedCount } = runPlatformNamesNormalization(db);
  assert.equal(mergedCount, 1);
  // Winner ('lodgify') is renamed to canonical 'Lodgify' in step C.
  assert.equal(renamedCount, 1);

  const platforms = db.prepare('SELECT name FROM platforms').all().map((r) => r.name);
  assert.deepEqual(platforms, ['Lodgify']);
  const resPlatforms = db.prepare('SELECT platform FROM reservations ORDER BY id').all().map((r) => r.platform);
  assert.deepEqual(resPlatforms, ['Lodgify', 'Lodgify']);
});

test("'direct' enum stays lowercase, not merged with 'Direct'", () => {
  const db = fresh();
  db.prepare("INSERT INTO platforms (name) VALUES ('direct')").run();
  db.prepare("INSERT INTO platforms (name) VALUES ('Direct')").run();
  db.prepare("INSERT INTO reservations (platform) VALUES ('direct')").run();
  db.prepare("INSERT INTO reservations (platform) VALUES ('Direct')").run();
  db.prepare("INSERT INTO reservations (platform) VALUES ('DIRECT')").run();

  runPlatformNamesNormalization(db);

  // Both platforms rows collapse to a single 'direct' (lowercase canonical for the enum).
  const platforms = db.prepare('SELECT name FROM platforms').all().map((r) => r.name);
  assert.deepEqual(platforms, ['direct']);
  // Reservations: every casing collapses to 'direct'.
  const resPlatforms = db.prepare("SELECT platform FROM reservations").all().map((r) => r.platform);
  for (const p of resPlatforms) assert.equal(p, 'direct');
});

test('idempotent: re-running the migration on already-normalized data is a no-op', () => {
  const db = fresh();
  db.prepare("INSERT INTO platforms (name) VALUES ('Airbnb')").run();
  db.prepare("INSERT INTO ical_sources (platformLabel) VALUES ('Airbnb')").run();
  db.prepare("INSERT INTO reservations (platform) VALUES ('Airbnb')").run();

  const first = runPlatformNamesNormalization(db);
  assert.equal(first.mergedCount, 0);
  assert.equal(first.renamedCount, 0);

  const second = runPlatformNamesNormalization(db);
  assert.equal(second.mergedCount, 0);
  assert.equal(second.renamedCount, 0);
});

test('source tables: defensive pass renames orphan labels (no matching platforms row)', () => {
  const db = fresh();
  // Reservation references a platform that doesn't exist in `platforms` yet (legitimate —
  // operator typed it once on a manual reservation).
  db.prepare("INSERT INTO reservations (platform) VALUES ('booking')").run();
  db.prepare("INSERT INTO ical_sources (platformLabel) VALUES ('Booking')").run();

  runPlatformNamesNormalization(db);

  // Reservation's `booking` was renamed to canonical `Booking`.
  const resPlatform = db.prepare('SELECT platform FROM reservations').get().platform;
  assert.equal(resPlatform, 'Booking');
});

test("empty / whitespace-only platforms rows are left untouched (operator's manual fix)", () => {
  const db = fresh();
  db.prepare("INSERT INTO platforms (name) VALUES ('  ')").run();  // edge: whitespace
  db.prepare("INSERT INTO reservations (platform) VALUES ('  ')").run();

  runPlatformNamesNormalization(db);

  // The whitespace-only platform row stayed (formatter returns '' so we skip the group).
  const platforms = db.prepare('SELECT name FROM platforms').all().map((r) => r.name);
  assert.deepEqual(platforms, ['  ']);
  // Reservation: defensive pass tries to rename, but '' is the canonical → no UPDATE.
  const resPlatform = db.prepare('SELECT platform FROM reservations').get().platform;
  assert.equal(resPlatform, '  ');
});

test('multi-segment input: GitesDeFrance survives a second normalization without word-boundary loss', () => {
  const db = fresh();
  db.prepare("INSERT INTO platforms (name) VALUES ('Gîtes de France')").run();

  runPlatformNamesNormalization(db);

  const platforms = db.prepare('SELECT name FROM platforms').all().map((r) => r.name);
  assert.deepEqual(platforms, ['GitesDeFrance']);

  // Re-running: detects no drift, no rename.
  const second = runPlatformNamesNormalization(db);
  assert.equal(second.renamedCount, 0);
});
