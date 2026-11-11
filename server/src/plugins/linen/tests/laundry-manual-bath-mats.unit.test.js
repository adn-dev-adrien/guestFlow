const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// specs/laundry-bath-mat.md rule 13 — the manual line of a laundry trip counts bath mats too: the
// column is migrated onto existing installs (rows read 0), stored signed, summed over a window like the
// other types (mega review #5, M4).
const { MIGRATIONS } = require('../migrations');
const model = require('../manualAdditionsModel');

function migratedDb() {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE migrations (name TEXT PRIMARY KEY, appliedAt TEXT DEFAULT (datetime('now')))");
  db.exec("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)");
  for (const m of MIGRATIONS.filter((x) => x.name !== 'manual_additions_bath_mats_v1')) {
    try { m.up(db); } catch { /* the settings copy needs the core table: irrelevant here */ }
  }
  db.prepare("INSERT INTO laundry_trip_manual_additions (tripDate, doubleBeds) VALUES ('2026-10-20', 2)").run();
  MIGRATIONS.find((x) => x.name === 'manual_additions_bath_mats_v1').up(db);
  return db;
}

test('rule 13 — the migration adds bathMats, existing rows read 0, and it is idempotent', () => {
  const db = migratedDb();
  MIGRATIONS.find((x) => x.name === 'manual_additions_bath_mats_v1').up(db);
  const m = model.create(db);
  assert.equal(m.get('2026-10-20').bathMats, 0);
  assert.equal(m.get('2026-10-20').doubleBeds, 2);
});

test('rule 13 — bath mats are stored signed and summed over a window', () => {
  const m = model.create(migratedDb());
  m.set('2026-10-27', { bathMats: 3 });
  m.set('2026-11-03', { bathMats: -1, smallTowels: 2 });
  assert.equal(m.get('2026-10-27').bathMats, 3);
  assert.equal(m.get('2026-11-03').bathMats, -1);
  assert.equal(m.sumForWindow('2026-10-21', '2026-11-03').bathMats, 2);
  m.set('2026-10-27', { bathMats: 0 });
  assert.equal(Object.keys(m.listAll()).includes('2026-10-27'), false, 'an all-zero line is no row');
});
