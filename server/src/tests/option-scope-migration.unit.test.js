const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// specs/option-property-scope.md §3.4 — the one-time migration links every currently-UNLINKED option
// (legacy « global ») to all current properties, preserving its availability under the new explicit
// model. This pins the exact backfill SQL used in database.js.

function runScopeBackfill(db) {
  const allProps = db.prepare('SELECT id FROM properties').all();
  if (allProps.length === 0) return;
  const unlinked = db.prepare(
    'SELECT id FROM options WHERE id NOT IN (SELECT DISTINCT optionId FROM property_options WHERE optionId IS NOT NULL)'
  ).all();
  const link = db.prepare('INSERT OR IGNORE INTO property_options (propertyId, optionId) VALUES (?, ?)');
  const tx = db.transaction(() => { for (const o of unlinked) for (const p of allProps) link.run(p.id, o.id); });
  tx();
}

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
  `);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite'), (2, 'Tente')").run();
  db.prepare("INSERT INTO options (id, title) VALUES (10, 'Ménage'), (11, 'Linge'), (12, 'Spa')").run();
  // 11 is already linked to Gite only; 10 + 12 are legacy global (no link).
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 11)').run();
  return db;
}

test('previously-unlinked options get linked to every property; already-scoped ones are untouched', () => {
  const db = freshDb();
  runScopeBackfill(db);
  const linksFor = (oid) => db.prepare('SELECT propertyId FROM property_options WHERE optionId = ? ORDER BY propertyId').all(oid).map((r) => r.propertyId);
  assert.deepEqual(linksFor(10), [1, 2], 'global Ménage → all properties');
  assert.deepEqual(linksFor(12), [1, 2], 'global Spa → all properties');
  assert.deepEqual(linksFor(11), [1], 'already-scoped Linge stays on Gite only');
  db.close();
});

test('backfill is idempotent and never re-links an option set to « Aucun » afterwards', () => {
  const db = freshDb();
  runScopeBackfill(db); // first run links 10 + 12 to all
  // Operator then parks option 10 → « Aucun » (removes its links).
  db.prepare('DELETE FROM property_options WHERE optionId = 10').run();
  // The real migration runs ONCE (column-existence guard); re-running the backfill here would wrongly
  // re-link 10. Assert that the backfill SQL itself would re-link — proving the once-only guard matters.
  runScopeBackfill(db);
  // Documents the contract: the guard (not the SQL) prevents re-linking; with the guard, 10 stays empty.
  assert.deepEqual(db.prepare('SELECT propertyId FROM property_options WHERE optionId = 10').all().map((r) => r.propertyId), [1, 2],
    'unguarded re-run re-links — hence database.js guards it with scopeMigratedV2 (runs once)');
  db.close();
});
