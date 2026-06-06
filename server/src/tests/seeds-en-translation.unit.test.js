// EN translation seeding for the 3 typed-default options.
// See specs/devis-english-language.md §3 rule 6 + the bed-linen / bathroom-linen / breakfast
// seeds' SEED_DEFINITION{,_EN} pairs.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { ensureDefaultBedLinenOption, SEED_DEFINITION: BED_FR } = require('../utils/bedLinenSeed');
const { ensureDefaultBathroomLinenOption, SEED_DEFINITION: BATH_FR, SEED_DEFINITION_EN: BATH_EN } = require('../utils/bathroomLinenSeed');
const { ensureDefaultBreakfastOption, SEED_DEFINITION: BREAK_FR, SEED_DEFINITION_EN: BREAK_EN } = require('../utils/breakfastSeed');

const SILENT = { log() {} };

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT, description TEXT, priceType TEXT, price REAL,
      optionProgressiveTiers TEXT,
      autoOptionType TEXT, autoEnabled INTEGER, autoPricingMode TEXT, autoFullNightThreshold TEXT,
      countsAsBedLinen INTEGER DEFAULT 0, countsAsBathroomLinen INTEGER DEFAULT 0,
      titleEn TEXT NOT NULL DEFAULT '',
      descriptionEn TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}

// ---- bed-linen ----

test('bed-linen seed: fresh insert carries titleEn = "Bed linen" + non-empty descriptionEn', () => {
  const db = freshDb();
  ensureDefaultBedLinenOption(db, { logger: SILENT });
  const row = db.prepare("SELECT title, titleEn, descriptionEn FROM options WHERE autoOptionType = 'bed_linen'").get();
  assert.ok(row);
  assert.equal(row.title, BED_FR.title);
  assert.equal(row.titleEn, 'Bed linen');
  assert.ok(row.descriptionEn.length > 0, 'descriptionEn populated on fresh seed');
});

test('bed-linen seed: backfills titleEn on a pre-existing typed row with empty titleEn', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO options (title, description, priceType, price, autoOptionType, titleEn, descriptionEn)
              VALUES ('Linge de lit', '', 'per_stay', 0, 'bed_linen', '', '')`).run();
  ensureDefaultBedLinenOption(db, { logger: SILENT });
  const row = db.prepare("SELECT titleEn, descriptionEn FROM options WHERE autoOptionType = 'bed_linen'").get();
  assert.equal(row.titleEn, 'Bed linen');
  assert.ok(row.descriptionEn.length > 0, 'descriptionEn backfilled too');
});

test('bed-linen seed: does NOT overwrite operator-supplied titleEn', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO options (title, description, priceType, price, autoOptionType, titleEn, descriptionEn)
              VALUES ('Linge de lit', '', 'per_stay', 0, 'bed_linen', 'Sheets only', 'Custom')`).run();
  ensureDefaultBedLinenOption(db, { logger: SILENT });
  const row = db.prepare("SELECT titleEn, descriptionEn FROM options WHERE autoOptionType = 'bed_linen'").get();
  assert.equal(row.titleEn, 'Sheets only', 'operator EN title preserved');
  assert.equal(row.descriptionEn, 'Custom', 'operator EN description preserved');
});

test('bed-linen seed: promotion path (legacy "Linge de lits" row) gets titleEn backfilled too', () => {
  const db = freshDb();
  // Legacy row: French alias, no autoOptionType yet.
  db.prepare(`INSERT INTO options (title, description, priceType, price, autoOptionType, countsAsBedLinen, titleEn, descriptionEn)
              VALUES ('Linge de lits', '', 'per_stay', 0, NULL, 0, '', '')`).run();
  ensureDefaultBedLinenOption(db, { logger: SILENT });
  const row = db.prepare("SELECT autoOptionType, titleEn FROM options WHERE LOWER(title) = 'linge de lits'").get();
  assert.equal(row.autoOptionType, 'bed_linen', 'row promoted to typed');
  assert.equal(row.titleEn, 'Bed linen', 'backfill catches the promoted row');
});

// ---- bathroom-linen ----

test('bathroom-linen seed: fresh insert carries titleEn = "Bath linen"', () => {
  const db = freshDb();
  ensureDefaultBathroomLinenOption(db, { logger: SILENT });
  const row = db.prepare("SELECT titleEn, descriptionEn FROM options WHERE autoOptionType = 'bathroom_linen'").get();
  assert.equal(row.titleEn, BATH_EN.title);
  assert.equal(row.titleEn, 'Bath linen');
  assert.ok(row.descriptionEn.length > 0);
});

test('bathroom-linen seed: backfills titleEn on existing typed row with empty EN', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO options (title, description, priceType, price, autoOptionType, countsAsBathroomLinen, titleEn)
              VALUES ('Linge de toilette', '', 'per_stay', 0, 'bathroom_linen', 1, '')`).run();
  ensureDefaultBathroomLinenOption(db, { logger: SILENT });
  const row = db.prepare("SELECT titleEn FROM options WHERE autoOptionType = 'bathroom_linen'").get();
  assert.equal(row.titleEn, 'Bath linen');
});

// ---- breakfast ----

test('breakfast seed: fresh insert carries titleEn = "Breakfast"', () => {
  const db = freshDb();
  ensureDefaultBreakfastOption(db, { logger: SILENT });
  const row = db.prepare("SELECT titleEn, descriptionEn FROM options WHERE autoOptionType = 'breakfast'").get();
  assert.equal(row.titleEn, BREAK_EN.title);
  assert.equal(row.titleEn, 'Breakfast');
  assert.ok(row.descriptionEn.length > 0);
});

test('breakfast seed: backfills titleEn on existing typed row', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO options (title, description, priceType, price, autoOptionType, titleEn)
              VALUES ('Petit déjeuner', '', 'per_person_per_night', 0, 'breakfast', '')`).run();
  ensureDefaultBreakfastOption(db, { logger: SILENT });
  const row = db.prepare("SELECT titleEn FROM options WHERE autoOptionType = 'breakfast'").get();
  assert.equal(row.titleEn, 'Breakfast');
});

test('all three seeds are idempotent across the EN backfill — second run is a no-op', () => {
  const db = freshDb();
  for (let i = 0; i < 3; i += 1) {
    ensureDefaultBedLinenOption(db, { logger: SILENT });
    ensureDefaultBathroomLinenOption(db, { logger: SILENT });
    ensureDefaultBreakfastOption(db, { logger: SILENT });
  }
  const count = db.prepare("SELECT COUNT(*) AS n FROM options").get().n;
  assert.equal(count, 3, 'still exactly one typed row per seed family');
  // EN translations stable.
  assert.equal(db.prepare("SELECT titleEn FROM options WHERE autoOptionType = 'bed_linen'").get().titleEn, 'Bed linen');
  assert.equal(db.prepare("SELECT titleEn FROM options WHERE autoOptionType = 'bathroom_linen'").get().titleEn, 'Bath linen');
  assert.equal(db.prepare("SELECT titleEn FROM options WHERE autoOptionType = 'breakfast'").get().titleEn, 'Breakfast');
});
