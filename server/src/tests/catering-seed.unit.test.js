// specs/option-categories.md §3 rules 21-26, §5.2 — the « Boissons » + « Restauration » seed.
//
// Same family as bed-linen-seed / bath-mat-seed, with the extra property that this seed owns
// MANY rows keyed by `seedKey` instead of a single row keyed by `autoOptionType`. The tests below
// are mostly about that difference: an operator edit must survive, a delete must not.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  ensureCateringOptions, SEED_DEFINITIONS, DRINKS_CATEGORY, CATERING_CATEGORY,
} = require('../utils/cateringSeed');

const NULL_LOGGER = { log() {} };

function makeDb({ properties = [1, 2] } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      priceType TEXT,
      price REAL,
      optionProgressiveTiers TEXT DEFAULT '[]',
      autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed',
      countsAsBedLinen INTEGER NOT NULL DEFAULT 0,
      countsAsBathroomLinen INTEGER NOT NULL DEFAULT 0,
      displayToClient INTEGER NOT NULL DEFAULT 1,
      archivedAt TEXT,
      category TEXT NOT NULL DEFAULT '',
      seedKey TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
    CREATE TABLE property_options (
      propertyId INTEGER NOT NULL,
      optionId INTEGER NOT NULL,
      PRIMARY KEY (propertyId, optionId)
    );
  `);
  for (const id of properties) db.prepare('INSERT INTO properties (id, name) VALUES (?, ?)').run(id, `Logement ${id}`);
  return db;
}

const seedCount = SEED_DEFINITIONS.length;

test('fresh DB: inserts every article with the expected shape', () => {
  const db = makeDb();
  const result = ensureCateringOptions(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'seeded');
  assert.equal(result.inserted, seedCount);
  assert.equal(result.adopted, 0);

  const rows = db.prepare("SELECT * FROM options WHERE seedKey <> '' ORDER BY seedKey").all();
  assert.equal(rows.length, seedCount);
  for (const row of rows) {
    const def = SEED_DEFINITIONS.find((d) => d.seedKey === row.seedKey);
    assert.ok(def, `unknown seedKey ${row.seedKey}`);
    assert.equal(row.title, def.title);
    assert.equal(row.description, def.description);
    assert.equal(Number(row.price), def.price);
    assert.equal(row.category, def.category);
    // Unit price × operator-entered quantity (spec rule 21) — never a per-person multiplier.
    assert.equal(row.priceType, 'per_stay');
    // Guests may see and pick them (resolved 2026-08-06).
    assert.equal(Number(row.displayToClient), 1);
  }
});

test('the two categories hold the expected counts and the prices match the price list', () => {
  const db = makeDb();
  ensureCateringOptions(db, { logger: NULL_LOGGER });
  const drinks = db.prepare('SELECT title, price FROM options WHERE category = ? ORDER BY price').all(DRINKS_CATEGORY);
  const boards = db.prepare('SELECT title, price FROM options WHERE category = ? ORDER BY price').all(CATERING_CATEGORY);
  assert.equal(drinks.length, 9);
  assert.equal(boards.length, 5);
  assert.deepEqual(drinks.map((r) => r.price), [3, 5, 5.5, 6, 6.5, 7.5, 7.5, 25, 40]);
  assert.deepEqual(boards.map((r) => r.price), [17, 32, 52, 78, 115]);
});

test('every article is linked to every property', () => {
  const db = makeDb({ properties: [1, 2] });
  ensureCateringOptions(db, { logger: NULL_LOGGER });
  const links = db.prepare('SELECT COUNT(*) AS n FROM property_options').get().n;
  assert.equal(links, seedCount * 2);
});

test('second run is a no-op — no duplicate, no extra link', () => {
  const db = makeDb();
  ensureCateringOptions(db, { logger: NULL_LOGGER });
  const result = ensureCateringOptions(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'skipped-already-seeded');
  assert.equal(result.inserted, 0);
  assert.equal(result.adopted, 0);
  assert.equal(result.linked, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, seedCount);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM property_options').get().n, seedCount * 2);
});

test('operator edits survive a reboot — a renamed/re-priced article is NOT duplicated', () => {
  // This is the whole reason the seed keys on `seedKey` rather than on the title (spec rule 23).
  const db = makeDb();
  ensureCateringOptions(db, { logger: NULL_LOGGER });
  db.prepare("UPDATE options SET title = ?, price = 8.9, description = 'Nouvelle cuvée' WHERE seedKey = 'drink_madmax_75'")
    .run('Mad Max 75cl - 6°');

  const result = ensureCateringOptions(db, { logger: NULL_LOGGER });
  assert.equal(result.inserted, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, seedCount);
  const row = db.prepare("SELECT * FROM options WHERE seedKey = 'drink_madmax_75'").get();
  assert.equal(row.title, 'Mad Max 75cl - 6°');
  assert.equal(Number(row.price), 8.9);
  assert.equal(row.description, 'Nouvelle cuvée');
});

test('archiving an article retires it for good — the seed does not resurrect it', () => {
  // spec rule 25: DELETE in GuestFlow is a soft-delete, and it must stick.
  const db = makeDb();
  ensureCateringOptions(db, { logger: NULL_LOGGER });
  db.prepare("UPDATE options SET archivedAt = datetime('now') WHERE seedKey = 'drink_champagne_37'").run();

  const result = ensureCateringOptions(db, { logger: NULL_LOGGER });
  assert.equal(result.inserted, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, seedCount);
  const rows = db.prepare("SELECT archivedAt FROM options WHERE seedKey = 'drink_champagne_37'").all();
  assert.equal(rows.length, 1);
  assert.ok(rows[0].archivedAt, 'the article must stay archived');
});

test('a hard-deleted article comes back on the next boot', () => {
  const db = makeDb();
  ensureCateringOptions(db, { logger: NULL_LOGGER });
  db.prepare("DELETE FROM options WHERE seedKey = 'board_xxl'").run();

  const result = ensureCateringOptions(db, { logger: NULL_LOGGER });
  assert.equal(result.inserted, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, seedCount);
});

test('a same-titled hand-made option is adopted, not duplicated', () => {
  // spec rule 24 — the operator may have created « Jus de pomme 1L » before this shipped.
  const db = makeDb();
  db.prepare("INSERT INTO options (title, description, priceType, price) VALUES (?, ?, 'per_stay', ?)")
    .run('  jus de pomme 1L ', 'Ma description à moi', 4.2);

  const result = ensureCateringOptions(db, { logger: NULL_LOGGER });
  assert.equal(result.adopted, 1);
  assert.equal(result.inserted, seedCount - 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, seedCount);

  const row = db.prepare("SELECT * FROM options WHERE seedKey = 'drink_jus_pomme_1l'").get();
  assert.equal(row.category, DRINKS_CATEGORY);
  // Adoption tags the row; it never overwrites what the operator wrote.
  assert.equal(row.description, 'Ma description à moi');
  assert.equal(Number(row.price), 4.2);
});

test('a property created after the first seed run gets the whole catalogue linked', () => {
  const db = makeDb({ properties: [1] });
  ensureCateringOptions(db, { logger: NULL_LOGGER });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM property_options').get().n, seedCount);

  db.prepare('INSERT INTO properties (id, name) VALUES (3, ?)').run('Nouveau gîte');
  const result = ensureCateringOptions(db, { logger: NULL_LOGGER });
  assert.equal(result.inserted, 0);
  assert.equal(result.linked, seedCount);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM property_options WHERE propertyId = 3').get().n, seedCount);
});

test('seedKeys are unique and non-empty', () => {
  const keys = SEED_DEFINITIONS.map((d) => d.seedKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.every((k) => typeof k === 'string' && k.length > 0));
});

test('unmigrated schema: silent no-op rather than a crash', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE options (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);');
  const result = ensureCateringOptions(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'skipped-schema');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, 0);
});
