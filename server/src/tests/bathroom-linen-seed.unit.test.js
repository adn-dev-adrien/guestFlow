const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { ensureDefaultBathroomLinenOption, SEED_DEFINITION } = require('../utils/bathroomLinenSeed');

// Strict mirror of bed-linen-seed.unit.test.js, only swapping the flag column + autoOptionType.

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
      countsAsBathroomLinen INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

test('seed on a fresh DB: inserts one bathroom_linen option with the expected shape', () => {
  const db = makeDb();
  const result = ensureDefaultBathroomLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'seeded');

  const rows = db.prepare("SELECT * FROM options WHERE autoOptionType = 'bathroom_linen'").all();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.title, SEED_DEFINITION.title);
  assert.equal(row.autoOptionType, 'bathroom_linen');
  assert.equal(Number(row.countsAsBathroomLinen), 1);
  assert.equal(Number(row.countsAsBedLinen), 0, 'NOT a bed-linen seed; the two are independent');
  assert.equal(Number(row.autoEnabled), 0);
  assert.equal(row.priceType, 'per_stay');
  assert.equal(Number(row.price), 0);
});

test('seed is idempotent: second call inserts nothing', () => {
  const db = makeDb();
  ensureDefaultBathroomLinenOption(db, { logger: NULL_LOGGER });
  const result = ensureDefaultBathroomLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'skipped-already-seeded');
  const n = db.prepare("SELECT COUNT(*) AS n FROM options WHERE autoOptionType = 'bathroom_linen'").get().n;
  assert.equal(n, 1, 'no duplicate row');
});

test('seed PROMOTES an operator-customised option in place (keeps title/price, adds autoOptionType)', () => {
  // Strict mirror of the bed-linen promotion behaviour.
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price, countsAsBathroomLinen) VALUES ('Accès SPA + serviettes', 'per_stay', 25, 1)"
  ).run();

  const result = ensureDefaultBathroomLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'promoted-adopted');
  assert.equal(result.count, 1);
  const all = db.prepare('SELECT * FROM options ORDER BY id').all();
  assert.equal(all.length, 1);
  assert.equal(all[0].title, 'Accès SPA + serviettes');
  assert.equal(Number(all[0].price), 25);
  assert.equal(all[0].autoOptionType, 'bathroom_linen', 'now undeletable in the UI');
});

test('seed PROMOTES by title alias: "Linge de toilette" exact match (case-insensitive)', () => {
  // Adrien's prod scenario: exact title "Linge de toilette" exists without the flag (the
  // checkbox is hidden in the UI now). Must be promoted transparently.
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price) VALUES ('Linge de toilette', 'per_stay', 6)"
  ).run();

  const result = ensureDefaultBathroomLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'promoted-adopted');
  assert.equal(result.count, 1);
  const row = db.prepare("SELECT * FROM options WHERE title = 'Linge de toilette'").get();
  assert.equal(row.autoOptionType, 'bathroom_linen');
  assert.equal(Number(row.countsAsBathroomLinen), 1);
  assert.equal(Number(row.price), 6);
});

test('seed promotion by title is case-insensitive + trim-tolerant (bathroom)', () => {
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price) VALUES (' Linge De Toilette ', 'per_stay', 0)"
  ).run();
  const result = ensureDefaultBathroomLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'promoted-adopted');
});

test('seed does NOT promote an unrelated title (no fuzzy match — only the exact alias list)', () => {
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price) VALUES ('Serviette piscine', 'per_stay', 4)"
  ).run();
  const result = ensureDefaultBathroomLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'seeded');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM options").get().n, 2);
});

test('seed and bed-linen seed do NOT conflict: each only checks its own flag', () => {
  // Prod where Adrien already adopted the bed-linen flag but NOT the bathroom-linen one yet
  // (typical upgrade path): the bathroom seed must still insert because countsAsBedLinen=1 is
  // not the same signal as countsAsBathroomLinen=1.
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price, countsAsBedLinen) VALUES ('Linge de lit perso', 'per_stay', 0, 1)"
  ).run();

  const result = ensureDefaultBathroomLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'seeded');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, 2);
});

test('seed inserts even when other unrelated options exist, none flagged for bathroom', () => {
  const db = makeDb();
  db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Ménage', 'per_stay', 80)").run();

  const result = ensureDefaultBathroomLinenOption(db, { logger: NULL_LOGGER });
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
      -- countsAsBathroomLinen intentionally absent
    );
  `);
  const result = ensureDefaultBathroomLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'skipped-schema');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, 0);
});

test('seed catches any thrown error and returns { action: "error" }', () => {
  const fake = {
    prepare() {
      throw new Error('SQLITE_BUSY: simulated');
    },
  };
  const result = ensureDefaultBathroomLinenOption(fake, { logger: NULL_LOGGER });
  assert.equal(result.action, 'error');
  assert.match(result.error, /SQLITE_BUSY/);
});

// --- 2026-06-03 regression — same fix mirrored for bathroom-linen ---

test('REGRESSION: typed seed exists + a legacy alias row is STILL promoted on next boot', () => {
  // Strict mirror of the bed-linen regression — see bed-linen-seed.unit.test.js for the prod
  // history. The bathroom seed must apply the same fix so any future legacy alias
  // ("linge de toilette" variant) is caught on the next boot.
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, autoOptionType, countsAsBathroomLinen, priceType, price) VALUES ('Linge de toilette', 'bathroom_linen', 1, 'per_stay', 0)"
  ).run();
  db.prepare(
    "INSERT INTO options (title, priceType, price) VALUES ('linge de toilette', 'per_stay', 8)"
  ).run();

  const result = ensureDefaultBathroomLinenOption(db, { logger: NULL_LOGGER });
  // The lowercase alias matches the title list (case-insensitive); typed-seed already exists
  // → promotion still runs + emits `promoted-adopted`.
  assert.equal(result.action, 'promoted-adopted');
  assert.equal(result.count, 1);
  const all = db.prepare("SELECT * FROM options WHERE LOWER(TRIM(title)) = 'linge de toilette' ORDER BY id").all();
  assert.equal(all.length, 2);
  // Both rows now carry the marker → undeletable in the UI.
  for (const row of all) {
    assert.equal(row.autoOptionType, 'bathroom_linen');
    assert.equal(Number(row.countsAsBathroomLinen), 1);
  }
});
