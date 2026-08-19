const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { ensureCancellationInsuranceOption, SEED_KEY } = require('../utils/cancellationInsuranceSeed');

// specs/cancellation-insurance.md §3.2 rules 11-15 — an idempotent, non-destructive boot seed keyed
// on `seedKey`, linked to every property, exclusive on `isCancellationInsurance`, and seeded
// UNPRICED so the booking funnel is untouched until Adrien sets a tariff.

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
      autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT NOT NULL DEFAULT 'fixed',
      countsAsBedLinen INTEGER NOT NULL DEFAULT 0, countsAsBathroomLinen INTEGER NOT NULL DEFAULT 0,
      displayToClient INTEGER NOT NULL DEFAULT 1,
      seedKey TEXT NOT NULL DEFAULT '', isCancellationInsurance INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
  `);
  for (const id of properties) db.prepare('INSERT INTO properties (id, name) VALUES (?, ?)').run(id, `Gîte ${id}`);
  return db;
}

const seeded = (db) => db.prepare('SELECT * FROM options WHERE seedKey = ?').get(SEED_KEY);
const links = (db, optionId) => db.prepare('SELECT propertyId FROM property_options WHERE optionId = ? ORDER BY propertyId')
  .all(optionId).map((r) => r.propertyId);

test('first boot seeds one unpriced insurance, linked to every property', () => {
  const db = freshDb();
  const res = ensureCancellationInsuranceOption(db, SILENT);
  assert.equal(res.action, 'seeded');
  const row = seeded(db);
  assert.equal(row.title, 'Assurance annulation');
  assert.equal(row.titleEn, 'Cancellation insurance');
  assert.equal(row.priceType, 'percent_of_stay');
  assert.equal(row.price, 0, 'unpriced = proposed nowhere until Adrien sets a tariff');
  assert.equal(row.isCancellationInsurance, 1);
  assert.equal(row.displayToClient, 1);
  assert.deepEqual(links(db, row.id), [1, 2]);
  db.close();
});

test('second boot is a no-op — no duplicate, no overwritten tariff', () => {
  const db = freshDb();
  ensureCancellationInsuranceOption(db, SILENT);
  db.prepare("UPDATE options SET price = 4, title = 'Garantie annulation Solio' WHERE seedKey = ?").run(SEED_KEY);

  const res = ensureCancellationInsuranceOption(db, SILENT);
  assert.equal(res.action, 'skipped-already-seeded');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, 1);
  const row = seeded(db);
  assert.equal(row.price, 4, 'the operator tariff survives every boot');
  assert.equal(row.title, 'Garantie annulation Solio', 'so does the operator wording');
  db.close();
});

test('a property created later is linked on the next boot', () => {
  const db = freshDb({ properties: [1] });
  ensureCancellationInsuranceOption(db, SILENT);
  db.prepare("INSERT INTO properties (id, name) VALUES (9, 'Nouveau gîte')").run();

  const res = ensureCancellationInsuranceOption(db, SILENT);
  assert.equal(res.linked, 1);
  assert.deepEqual(links(db, seeded(db).id), [1, 9]);
  db.close();
});

test('a hand-made look-alike is adopted, not duplicated', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO options (id, title, priceType, price)
    VALUES (77, 'Garantie annulation', 'per_stay', 25)`).run();

  const res = ensureCancellationInsuranceOption(db, SILENT);
  assert.equal(res.action, 'promoted-adopted');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, 1, 'no duplicate beside it');
  const row = seeded(db);
  assert.equal(row.id, 77);
  assert.equal(row.price, 25, 'its price is left alone');
  assert.equal(row.priceType, 'per_stay', 'so is its price type — a flat premium is legitimate');
  assert.equal(row.isCancellationInsurance, 1);
  db.close();
});

test('an option that already carries another seedKey is never stolen', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO options (id, title, seedKey, priceType, price)
    VALUES (55, 'Assurance annulation', 'planche_s', 'per_stay', 17)`).run();

  const res = ensureCancellationInsuranceOption(db, SILENT);
  assert.equal(res.action, 'seeded');
  assert.equal(db.prepare('SELECT seedKey FROM options WHERE id = 55').get().seedKey, 'planche_s');
  assert.equal(seeded(db).id !== 55, true);
  db.close();
});

test('several flagged rows collapse onto the lowest id', () => {
  const db = freshDb();
  ensureCancellationInsuranceOption(db, SILENT);
  db.prepare(`INSERT INTO options (id, title, isCancellationInsurance) VALUES (90, 'Assurance bis', 1)`).run();

  const warnings = [];
  const res = ensureCancellationInsuranceOption(db, { logger: { log() {}, warn: (m) => warnings.push(m) } });
  assert.equal(res.deduped, 1);
  assert.equal(warnings.length, 1, 'one line, not one per row');
  const flagged = db.prepare('SELECT id FROM options WHERE isCancellationInsurance = 1').all().map((r) => r.id);
  assert.deepEqual(flagged, [seeded(db).id]);
  db.close();
});

test('an archived insurance counts as present — archiving retires it for good', () => {
  const db = freshDb();
  db.exec('ALTER TABLE options ADD COLUMN archivedAt TEXT');
  ensureCancellationInsuranceOption(db, SILENT);
  db.prepare("UPDATE options SET archivedAt = '2026-08-19' WHERE seedKey = ?").run(SEED_KEY);

  ensureCancellationInsuranceOption(db, SILENT);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, 1, 'not resurrected beside it');
  db.close();
});

test('a schema without the column is skipped silently — the next boot catches up', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT); CREATE TABLE properties (id INTEGER PRIMARY KEY)');
  assert.equal(ensureCancellationInsuranceOption(db, SILENT).action, 'skipped-schema');
  db.close();
});
