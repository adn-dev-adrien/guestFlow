const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { assessDevisFusion, dropLegacyDevisTables, LEGACY_DEVIS_TABLES } = require('../utils/devisFusionMigration');

// specs/devis-reservation-fusion.md §4.1 (2026-06-17 fix) — the boot must decide robustly what to do
// with the legacy devis_* schema so prod never floods the dir with `.pre-devis-fusion-*.bak` and never
// loses data. Pins the four states of assessDevisFusion + the empty-leftover drop.

function freshDb({ withDevis = true } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation');
  `);
  if (withDevis) {
    db.exec(`
      CREATE TABLE devis (id INTEGER PRIMARY KEY AUTOINCREMENT, devisNumber TEXT);
      CREATE TABLE devis_options (id INTEGER PRIMARY KEY AUTOINCREMENT, devisId INTEGER);
      CREATE TABLE devis_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, devisId INTEGER);
      CREATE TABLE devis_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, devisId INTEGER);
      CREATE TABLE devis_nights (id INTEGER PRIMARY KEY AUTOINCREMENT, devisId INTEGER);
      CREATE TABLE devis_history (id INTEGER PRIMARY KEY AUTOINCREMENT, devisId INTEGER);
    `);
  }
  return db;
}

test("no devis table → 'noTable' (fresh install or fusion already completed)", () => {
  const db = freshDb({ withDevis: false });
  assert.equal(assessDevisFusion(db).action, 'noTable');
  db.close();
});

test("devis rows present, none fused → 'migrate'", () => {
  const db = freshDb();
  db.prepare("INSERT INTO devis (devisNumber) VALUES ('D-1'), ('D-2')").run();
  const a = assessDevisFusion(db);
  assert.equal(a.action, 'migrate');
  assert.equal(a.pendingDevis, 2);
  assert.equal(a.alreadyFused, 0);
  db.close();
});

test("rows already fused + EMPTY legacy tables → 'dropLeftover'", () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (kind) VALUES ('devis'), ('devis')").run(); // fused
  // devis_* all empty
  const a = assessDevisFusion(db);
  assert.equal(a.action, 'dropLeftover');
  assert.equal(a.legacyRowTotal, 0);
  // dropping leaves no devis_* tables → next assessment is 'noTable'
  dropLegacyDevisTables(db);
  assert.equal(assessDevisFusion(db).action, 'noTable');
  for (const t of LEGACY_DEVIS_TABLES) {
    assert.equal(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name=?").get(t).c, 0, `${t} dropped`);
  }
  db.close();
});

test("legacy rows AND fused rows coexist → 'skipAmbiguous' (never auto-resolve)", () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (kind) VALUES ('devis')").run();   // fused
  db.prepare("INSERT INTO devis (devisNumber) VALUES ('D-9')").run();      // legacy leftover with data
  const a = assessDevisFusion(db);
  assert.equal(a.action, 'skipAmbiguous');
  assert.equal(a.pendingDevis, 1);
  assert.equal(a.alreadyFused, 1);
  db.close();
});

test("orphan child rows (devis empty but a child has rows) → 'skipAmbiguous', not a silent drop", () => {
  const db = freshDb();
  db.prepare("INSERT INTO reservations (kind) VALUES ('devis')").run();
  db.prepare('INSERT INTO devis_options (devisId) VALUES (1)').run(); // orphan child data
  const a = assessDevisFusion(db);
  assert.equal(a.action, 'skipAmbiguous', 'must not drop tables that still hold rows');
  db.close();
});
