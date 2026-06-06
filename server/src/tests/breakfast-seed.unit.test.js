const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { ensureDefaultBreakfastOption } = require('../utils/breakfastSeed');

// specs/breakfast-option-and-planning-card.md §3 rule 1 + §7.1.
// Plain :memory: fixture covering only the `options` table — the seed touches nothing
// else. Mirrors the structure of `bed-linen-seed.unit.test.js`.

const DDL = `
  CREATE TABLE options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    priceType TEXT DEFAULT 'per_stay',
    price REAL DEFAULT 0,
    optionProgressiveTiers TEXT DEFAULT '[]',
    autoOptionType TEXT,
    autoEnabled INTEGER DEFAULT 0,
    autoPricingMode TEXT DEFAULT 'fixed',
    autoFullNightThreshold TEXT,
    countsAsBedLinen INTEGER DEFAULT 0,
    countsAsBathroomLinen INTEGER DEFAULT 0,
    linenIncludesSingle INTEGER DEFAULT 1,
    linenIncludesDouble INTEGER DEFAULT 1,
    linenIncludesBaby INTEGER DEFAULT 1,
    towelLargePerPerson INTEGER DEFAULT 1,
    towelMediumPerPerson INTEGER DEFAULT 0,
    towelSmallPerPerson INTEGER DEFAULT 1
  );
`;

function freshDb() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return db;
}

const silentLogger = { log: () => null };

test('fresh DB → seed inserts exactly one row with the typed marker + default columns', () => {
  const db = freshDb();
  const result = ensureDefaultBreakfastOption(db, { logger: silentLogger });
  assert.equal(result.action, 'seeded');
  const rows = db.prepare("SELECT * FROM options WHERE autoOptionType = 'breakfast'").all();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.title, 'Petit déjeuner');
  assert.equal(row.autoOptionType, 'breakfast');
  assert.equal(row.priceType, 'per_person_per_night');
  assert.equal(Number(row.price), 0);
  assert.equal(Number(row.autoEnabled), 0);
  assert.equal(Number(row.countsAsBedLinen), 0);
  assert.equal(Number(row.countsAsBathroomLinen), 0);
});

test('existing matching-title row without marker → promoted, no duplicate inserted', () => {
  const db = freshDb();
  // Operator created "Petit déjeuner" by hand before the feature shipped.
  db.prepare("INSERT INTO options (title) VALUES ('Petit déjeuner')").run();
  const result = ensureDefaultBreakfastOption(db, { logger: silentLogger });
  assert.equal(result.action, 'promoted-adopted');
  assert.equal(result.count, 1);
  const rows = db.prepare("SELECT * FROM options WHERE autoOptionType = 'breakfast'").all();
  assert.equal(rows.length, 1, 'exactly one row carries the typed marker');
  // The promotion path keeps the existing title/description; it only adds the marker.
  assert.equal(rows[0].title, 'Petit déjeuner');
});

test('existing typed row → skip, no duplicate', () => {
  const db = freshDb();
  db.prepare("INSERT INTO options (title, autoOptionType) VALUES ('Petit déjeuner', 'breakfast')").run();
  const result = ensureDefaultBreakfastOption(db, { logger: silentLogger });
  assert.equal(result.action, 'skipped-already-seeded');
  const count = db.prepare("SELECT COUNT(*) AS n FROM options WHERE autoOptionType = 'breakfast'").get().n;
  assert.equal(count, 1, 'no duplicate inserted');
});

test('two consecutive boots → count stays at 1 (idempotent)', () => {
  const db = freshDb();
  ensureDefaultBreakfastOption(db, { logger: silentLogger });
  const second = ensureDefaultBreakfastOption(db, { logger: silentLogger });
  assert.equal(second.action, 'skipped-already-seeded');
  const count = db.prepare("SELECT COUNT(*) AS n FROM options WHERE autoOptionType = 'breakfast'").get().n;
  assert.equal(count, 1);
});

test('alias "petit-déjeuner" (with hyphen) is promoted to the typed marker too', () => {
  const db = freshDb();
  db.prepare("INSERT INTO options (title) VALUES ('Petit-déjeuner')").run();
  ensureDefaultBreakfastOption(db, { logger: silentLogger });
  const rows = db.prepare("SELECT title FROM options WHERE autoOptionType = 'breakfast'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Petit-déjeuner', 'original title preserved through promotion');
});
