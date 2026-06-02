const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { ensureDefaultBedLinenOption, SEED_DEFINITION } = require('../utils/bedLinenSeed');

// Pins the three branches of the seed:
//   - fresh install: inserts the typed option (idempotent on second run).
//   - prod where Adrien already manually created an option + ticked countsAsBedLinen: skipped.
//   - prod with options but none flagged: still inserts.

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
      countsAsBedLinen INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

test('seed on a fresh DB: inserts one bed_linen option with the expected shape', () => {
  const db = makeDb();
  const result = ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'seeded');

  const rows = db.prepare("SELECT * FROM options WHERE autoOptionType = 'bed_linen'").all();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.title, SEED_DEFINITION.title);
  assert.equal(row.autoOptionType, 'bed_linen');
  assert.equal(Number(row.countsAsBedLinen), 1);
  assert.equal(Number(row.autoEnabled), 0, 'auto-add disabled: Adrien picks the option per reservation');
  assert.equal(row.priceType, 'per_stay');
  assert.equal(Number(row.price), 0, 'starts free; Adrien adjusts via the UI');
});

test('seed is idempotent: second call inserts nothing', () => {
  const db = makeDb();
  ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  const result = ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'skipped-already-seeded');
  const n = db.prepare("SELECT COUNT(*) AS n FROM options WHERE autoOptionType = 'bed_linen'").get().n;
  assert.equal(n, 1, 'no duplicate row');
});

test('seed skips when an operator-customised option already carries countsAsBedLinen=1', () => {
  // Models the prod scenario: Adrien had a "Linge" option BEFORE the feature shipped, then
  // upgraded + ticked the new countsAsBedLinen flag. The seeder must not duplicate it.
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price, countsAsBedLinen) VALUES ('Linge personnel', 'per_stay', 12, 1)"
  ).run();

  const result = ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'skipped-already-adopted');
  // The pre-existing option is untouched + no typed-seed row was added.
  const all = db.prepare('SELECT * FROM options ORDER BY id').all();
  assert.equal(all.length, 1);
  assert.equal(all[0].title, 'Linge personnel');
  assert.equal(all[0].autoOptionType, null);
});

test('seed inserts even when other unrelated options exist, none flagged', () => {
  // Prod that has options (cleaning, parking, etc.) but no linen flag → seed still runs.
  const db = makeDb();
  db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Ménage', 'per_stay', 80)").run();
  db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Parking', 'per_stay', 10)").run();

  const result = ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'seeded');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, 3);
});

test('seed degrades gracefully when the schema is missing the new column', () => {
  // Defensive: if the seeder runs before the migration block (shouldn't happen, but…), it
  // must not crash. The action tag reflects the skip reason for the boot log.
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      autoOptionType TEXT
      -- countsAsBedLinen intentionally absent
    );
  `);
  const result = ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'skipped-schema');
  // Nothing was inserted.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, 0);
});

test('seed catches any thrown error and returns { action: "error" }', () => {
  // Pass a fake "database" that throws to confirm the error path. We don't want the boot
  // to crash if SQLite is temporarily misbehaving — the spec keeps the seed best-effort.
  const fake = {
    prepare() {
      throw new Error('SQLITE_BUSY: simulated');
    },
  };
  const result = ensureDefaultBedLinenOption(fake, { logger: NULL_LOGGER });
  assert.equal(result.action, 'error');
  assert.match(result.error, /SQLITE_BUSY/);
});
