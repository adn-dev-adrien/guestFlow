// specs/guest-app/guest-app-home-automation.md rule 29 — `guest_home_blocks` accepts the « Réseau » block: the CHECK is widened by
// rebuilding the table, and every saved block survives.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { MIGRATIONS } = require('../migrations');

const run = (db, name) => MIGRATIONS.find((m) => m.name === name).up(db);

test('rule 29 — the rebuild keeps every row and accepts « grid »', () => {
  const db = new Database(':memory:');
  run(db, 'guest_home_blocks_v1');
  db.prepare(`INSERT INTO guest_home_blocks (propertyId, kind, position, "on", equipmentId, itemsJson, updatedAt)
    VALUES (1, 'rooms', 1, 1, NULL, '[{"id":"abcdef","label":"Séjour","equipmentId":"t"}]', 'x'),
           (1, 'energy', 4, 1, 'm', '[]', 'x')`).run();
  assert.throws(() => db.prepare(`INSERT INTO guest_home_blocks (propertyId, kind, position, updatedAt) VALUES (1, 'grid', 5, 'x')`).run());
  run(db, 'guest_home_blocks_grid_v1');
  const rows = db.prepare('SELECT kind, position, "on", equipmentId, itemsJson FROM guest_home_blocks ORDER BY position').all();
  assert.deepEqual(rows.map((r) => [r.kind, r.position, r.on, r.equipmentId]), [['rooms', 1, 1, null], ['energy', 4, 1, 'm']]);
  assert.equal(JSON.parse(rows[0].itemsJson)[0].label, 'Séjour');
  db.prepare(`INSERT INTO guest_home_blocks (propertyId, kind, position, updatedAt) VALUES (1, 'grid', 5, 'x')`).run();
  assert.throws(() => db.prepare(`INSERT INTO guest_home_blocks (propertyId, kind, position, updatedAt) VALUES (1, 'gate', 6, 'x')`).run());
});
