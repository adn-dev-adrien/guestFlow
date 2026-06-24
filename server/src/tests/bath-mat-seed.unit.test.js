const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { ensureDefaultBathMatOption, SEED_DEFINITION } = require('../utils/bathMatSeed');

// Strict mirror of bathroom-linen-seed.unit.test.js, swapping the flag column + autoOptionType.
// specs/laundry-bath-mat.md §3 rule 1.

const NULL_LOGGER = { log() {} };

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      priceType TEXT,
      price REAL,
      optionProgressiveTiers TEXT DEFAULT '[]',
      autoOptionType TEXT,
      autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed',
      autoFullNightThreshold TEXT,
      countsAsBedLinen INTEGER NOT NULL DEFAULT 0,
      countsAsBathroomLinen INTEGER NOT NULL DEFAULT 0,
      countsAsBathMat INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

test('seed on a fresh DB: inserts one bath_mat option with the expected shape', () => {
  const db = makeDb();
  const result = ensureDefaultBathMatOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'seeded');

  const rows = db.prepare("SELECT * FROM options WHERE autoOptionType = 'bath_mat'").all();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.title, SEED_DEFINITION.title);
  assert.equal(row.autoOptionType, 'bath_mat');
  assert.equal(Number(row.countsAsBathMat), 1);
  assert.equal(Number(row.countsAsBedLinen), 0, 'NOT a bed-linen seed');
  assert.equal(Number(row.countsAsBathroomLinen), 0, 'NOT a bathroom-linen seed');
  assert.equal(Number(row.autoEnabled), 0);
  assert.equal(row.priceType, 'per_stay');
  assert.equal(Number(row.price), 0);
});

test('seed is idempotent: second call inserts nothing', () => {
  const db = makeDb();
  ensureDefaultBathMatOption(db, { logger: NULL_LOGGER });
  const result = ensureDefaultBathMatOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'skipped-already-seeded');
  const n = db.prepare("SELECT COUNT(*) AS n FROM options WHERE autoOptionType = 'bath_mat'").get().n;
  assert.equal(n, 1, 'no duplicate row');
});

test('seed PROMOTES an operator-customised option in place (keeps title/price, adds autoOptionType)', () => {
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price, countsAsBathMat) VALUES ('Tapis salle de bain', 'per_stay', 3, 1)"
  ).run();

  const result = ensureDefaultBathMatOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'promoted-adopted');
  assert.equal(result.count, 1);
  const all = db.prepare('SELECT * FROM options ORDER BY id').all();
  assert.equal(all.length, 1);
  assert.equal(all[0].title, 'Tapis salle de bain');
  assert.equal(Number(all[0].price), 3);
  assert.equal(all[0].autoOptionType, 'bath_mat', 'now undeletable in the UI');
});

test('seed PROMOTES by title alias: "Tapis de bain" exact match (case-insensitive)', () => {
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price) VALUES ('Tapis de bain', 'per_stay', 5)"
  ).run();

  const result = ensureDefaultBathMatOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'promoted-adopted');
  assert.equal(result.count, 1);
  const row = db.prepare("SELECT * FROM options WHERE title = 'Tapis de bain'").get();
  assert.equal(row.autoOptionType, 'bath_mat');
  assert.equal(Number(row.countsAsBathMat), 1);
  assert.equal(Number(row.price), 5);
});

test('seed does NOT promote an unrelated title (only the exact alias list)', () => {
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price) VALUES ('Serviette piscine', 'per_stay', 4)"
  ).run();
  const result = ensureDefaultBathMatOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'seeded');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM options").get().n, 2);
});

test('seed does NOT conflict with bed/bathroom linen seeds: only checks its own flag', () => {
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price, countsAsBathroomLinen) VALUES ('Linge de toilette', 'per_stay', 0, 1)"
  ).run();
  const result = ensureDefaultBathMatOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'seeded');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, 2);
});

test('seed degrades gracefully when the schema is missing the new column', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      autoOptionType TEXT
      -- countsAsBathMat intentionally absent
    );
  `);
  const result = ensureDefaultBathMatOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'skipped-schema');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, 0);
});

test('seed catches any thrown error and returns { action: "error" }', () => {
  const fake = {
    prepare() { throw new Error('SQLITE_BUSY: simulated'); },
  };
  const result = ensureDefaultBathMatOption(fake, { logger: NULL_LOGGER });
  assert.equal(result.action, 'error');
  assert.match(result.error, /SQLITE_BUSY/);
});
