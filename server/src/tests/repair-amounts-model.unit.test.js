const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/repairAmountsModel');

// specs/extinguisher-seal-and-repair-amounts.md — operator-managed « Tarifs facturables » repair list.
// Keyed rows (repairKey) are protected; the extinguisher seal is always re-seeded on save.

function freshModel({ seed = true } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE repair_amounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repairKey TEXT, label TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0
    );
  `);
  if (seed) db.prepare("INSERT INTO repair_amounts (repairKey, label, price, sortOrder) VALUES ('extinguisher_seal', 'Plomb extincteur', 0, 0)").run();
  return buildModel(db);
}

test('list returns the seeded extinguisher row', () => {
  const model = freshModel();
  assert.deepEqual(model.list().map((r) => r.repairKey), ['extinguisher_seal']);
});

test('replaceAll persists custom rows, drops empty labels, coerces price ≥ 0', () => {
  const model = freshModel();
  const out = model.replaceAll([
    { repairKey: 'extinguisher_seal', label: 'Plomb extincteur', price: 25 },
    { label: 'Vitre cassée', price: -5 },
    { label: '   ', price: 10 }, // empty label → dropped
  ]);
  assert.equal(out.length, 2);
  const byLabel = Object.fromEntries(out.map((r) => [r.label, r]));
  assert.equal(byLabel['Plomb extincteur'].price, 25);
  assert.equal(byLabel['Plomb extincteur'].repairKey, 'extinguisher_seal');
  assert.equal(byLabel['Vitre cassée'].price, 0); // negative → 0
  assert.equal(byLabel['Vitre cassée'].repairKey, null);
});

test('replaceAll re-seeds extinguisher_seal (preserving its price) when the payload drops it', () => {
  const model = freshModel();
  model.replaceAll([{ repairKey: 'extinguisher_seal', label: 'Plomb extincteur', price: 30 }]);
  const out = model.replaceAll([{ label: 'Autre réparation', price: 5 }]); // keyed row omitted
  const seal = out.find((r) => r.repairKey === 'extinguisher_seal');
  assert.ok(seal, 'extinguisher_seal is re-seeded');
  assert.equal(seal.price, 30, 'price preserved across the re-seed');
});

test('replaceAll ignores a duplicate keyed row', () => {
  const model = freshModel();
  const out = model.replaceAll([
    { repairKey: 'extinguisher_seal', label: 'A', price: 1 },
    { repairKey: 'extinguisher_seal', label: 'B', price: 2 },
  ]);
  assert.equal(out.filter((r) => r.repairKey === 'extinguisher_seal').length, 1);
});
