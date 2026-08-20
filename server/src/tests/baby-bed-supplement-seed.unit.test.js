const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { ensureBabyBedSupplementOption, SEED_KEY, DEFAULT_PRICE } = require('../utils/babyBedSupplementSeed');

// specs/baby-bed-supplement.md §5 — an idempotent, non-destructive boot seed keyed on `seedKey`,
// linked to every property, carrying the engine contract (`autoOptionType = 'baby_bed'` +
// `autoEnabled = 1`) and the default 5 € per cot. It never overwrites what the operator changed.

const SILENT = { logger: { log() {}, warn() {} } };

function freshDb({ properties = [1, 2] } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT, titleEn TEXT NOT NULL DEFAULT '', description TEXT,
      priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      optionProgressiveTiers TEXT NOT NULL DEFAULT '[]',
      autoOptionType TEXT, autoEnabled INTEGER NOT NULL DEFAULT 0,
      autoPricingMode TEXT NOT NULL DEFAULT 'fixed',
      countsAsBedLinen INTEGER NOT NULL DEFAULT 0, countsAsBathroomLinen INTEGER NOT NULL DEFAULT 0,
      displayToClient INTEGER NOT NULL DEFAULT 1, seedKey TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
  `);
  for (const id of properties) db.prepare('INSERT INTO properties (id, name) VALUES (?, ?)').run(id, `Gîte ${id}`);
  return db;
}

const seeded = (db) => db.prepare('SELECT * FROM options WHERE seedKey = ?').get(SEED_KEY);
const links = (db, optionId) => db.prepare('SELECT propertyId FROM property_options WHERE optionId = ? ORDER BY propertyId')
  .all(optionId).map((r) => r.propertyId);

test('first boot seeds one 5 € cot supplement, linked to every property', () => {
  const db = freshDb();
  const res = ensureBabyBedSupplementOption(db, SILENT);
  assert.equal(res.action, 'seeded');
  const row = seeded(db);
  assert.equal(row.title, 'Lit bébé');
  assert.equal(row.titleEn, 'Baby cot');
  assert.equal(row.priceType, 'per_stay');
  assert.equal(row.price, DEFAULT_PRICE);
  assert.equal(row.autoOptionType, 'baby_bed');
  assert.equal(row.autoEnabled, 1, 'engine-derived: never ticked by hand');
  assert.equal(row.displayToClient, 1);
  assert.deepEqual(links(db, row.id), [1, 2]);
  db.close();
});

test('re-booting never duplicates the row nor re-writes it', () => {
  const db = freshDb();
  ensureBabyBedSupplementOption(db, SILENT);
  const first = seeded(db);
  const res = ensureBabyBedSupplementOption(db, SILENT);
  assert.equal(res.action, 'skipped-already-seeded');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, 1);
  assert.equal(seeded(db).id, first.id);
  db.close();
});

test('the operator owns the row: a renamed, re-priced supplement survives every boot', () => {
  const db = freshDb();
  ensureBabyBedSupplementOption(db, SILENT);
  const id = seeded(db).id;
  db.prepare("UPDATE options SET title = 'Lit parapluie', price = 8 WHERE id = ?").run(id);

  ensureBabyBedSupplementOption(db, SILENT);
  const row = seeded(db);
  assert.equal(row.id, id);
  assert.equal(row.title, 'Lit parapluie');
  assert.equal(row.price, 8);
  db.close();
});

test('a property created later is linked on the next boot', () => {
  const db = freshDb({ properties: [1] });
  ensureBabyBedSupplementOption(db, SILENT);
  const id = seeded(db).id;
  db.prepare("INSERT INTO properties (id, name) VALUES (3, 'Nouveau gîte')").run();

  const res = ensureBabyBedSupplementOption(db, SILENT);
  assert.equal(res.linked, 1);
  assert.deepEqual(links(db, id), [1, 3]);
  db.close();
});

test('a typed row whose seedKey was wiped is re-stamped, never doubled', () => {
  const db = freshDb();
  ensureBabyBedSupplementOption(db, SILENT);
  const id = seeded(db).id;
  db.prepare("UPDATE options SET seedKey = '' WHERE id = ?").run(id);

  ensureBabyBedSupplementOption(db, SILENT);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, 1);
  assert.equal(seeded(db).id, id, 'found back by autoOptionType, then re-stamped');
  db.close();
});

test('an operator-made « Lit bébé » option is reported, never hijacked', () => {
  const db = freshDb();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (99, 'Lit bébé', 'per_stay', 12)").run();

  const warnings = [];
  const res = ensureBabyBedSupplementOption(db, { logger: { log() {}, warn: (m) => warnings.push(m) } });
  assert.equal(res.action, 'seeded', 'the engine row is created beside it');
  assert.deepEqual(res.lookAlikes, [99]);
  assert.equal(warnings.length, 1);
  const manual = db.prepare('SELECT * FROM options WHERE id = 99').get();
  assert.equal(manual.autoEnabled, 0, 'the operator keeps their own option exactly as it was');
  assert.equal(manual.price, 12);
  db.close();
});

test('an unmigrated schema is skipped, not crashed', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT)');
  assert.equal(ensureBabyBedSupplementOption(db, SILENT).action, 'skipped-schema');
  db.close();
});

test('an archived supplement stays retired — the seed does not resurrect it', () => {
  const db = freshDb();
  db.exec('ALTER TABLE options ADD COLUMN archivedAt TEXT');
  ensureBabyBedSupplementOption(db, SILENT);
  const id = seeded(db).id;
  db.prepare("UPDATE options SET archivedAt = '2026-08-20' WHERE id = ?").run(id);

  ensureBabyBedSupplementOption(db, SILENT);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, 1);
  assert.equal(seeded(db).archivedAt, '2026-08-20');
  db.close();
});
