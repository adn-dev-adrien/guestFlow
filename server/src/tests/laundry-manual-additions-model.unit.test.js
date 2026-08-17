const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// specs/manual-laundry-additions.md §4.1 — per-trip manual linen additions model.
const model = require('../models/laundryManualAdditionsModel');

const ZEROS = { singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0 };

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE laundry_trip_manual_additions (
    tripDate TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
    singleBeds INTEGER NOT NULL DEFAULT 0, doubleBeds INTEGER NOT NULL DEFAULT 0, babyBeds INTEGER NOT NULL DEFAULT 0,
    largeTowels INTEGER NOT NULL DEFAULT 0, mediumTowels INTEGER NOT NULL DEFAULT 0, smallTowels INTEGER NOT NULL DEFAULT 0,
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  return model.create(db);
}

test('get → zeros when no row', () => {
  assert.deepEqual(makeDb().get('2026-06-09'), ZEROS);
});

test('set upserts, keeps the sign, rounds floats; get reads back; update replaces (not merges)', () => {
  // specs/laundry-manual-removals.md §3 rules 1-2 — a negative value is linen the operator washes
  // himself, withdrawn from the trip. It is stored as-is; the clamping lives where the trip is known.
  const m = makeDb();
  const stored = m.set('2026-06-09', { singleBeds: 2, doubleBeds: -1, largeTowels: 3.7, bogus: 9 });
  assert.equal(stored.singleBeds, 2);
  assert.equal(stored.doubleBeds, -1);  // withdrawal kept
  assert.equal(stored.largeTowels, 4);  // float rounded
  assert.equal(m.get('2026-06-09').singleBeds, 2);
  m.set('2026-06-09', { singleBeds: 5 }); // omitted fields → 0 (full replace)
  assert.equal(m.get('2026-06-09').singleBeds, 5);
  assert.equal(m.get('2026-06-09').largeTowels, 0);
});

test('set all-zero deletes the row', () => {
  const m = makeDb();
  m.set('2026-06-09', { singleBeds: 2 });
  m.set('2026-06-09', { singleBeds: 0 });
  assert.deepEqual(m.listAll(), {});
});

test('listAll returns only non-empty trips, keyed by date', () => {
  const m = makeDb();
  m.set('2026-06-09', { singleBeds: 2 });
  m.set('2026-06-16', { largeTowels: 1 });
  assert.deepEqual(Object.keys(m.listAll()).sort(), ['2026-06-09', '2026-06-16']);
  assert.equal(m.listAll()['2026-06-09'].singleBeds, 2);
});

test('sumForWindow sums only dates in (startExclusive, endInclusive]', () => {
  const m = makeDb();
  m.set('2026-06-09', { singleBeds: 2, largeTowels: 1 });
  m.set('2026-06-16', { singleBeds: 5 });
  m.set('2026-06-23', { singleBeds: 9 });
  const s = m.sumForWindow('2026-06-09', '2026-06-16'); // excludes 06-09 (start exclusive), includes 06-16
  assert.equal(s.singleBeds, 5);
  assert.equal(s.largeTowels, 0);
});

test('set rejects a non-ISO date', () => {
  assert.throws(() => makeDb().set('2026/06/09', { singleBeds: 1 }));
});

// ---- withdrawals (specs/laundry-manual-removals.md §3 rules 1-2) ----

test('a withdrawal-only trip is a real row (not an empty one) and survives a round-trip', () => {
  const m = makeDb();
  m.set('2026-06-09', { singleBeds: -2 });
  assert.equal(m.get('2026-06-09').singleBeds, -2);
  assert.deepEqual(Object.keys(m.listAll()), ['2026-06-09']);
});

test('sumForWindow adds signed values — an addition and a withdrawal cancel out', () => {
  const m = makeDb();
  m.set('2026-06-09', { singleBeds: 3 });
  m.set('2026-06-16', { singleBeds: -3, doubleBeds: -1 });
  const s = m.sumForWindow('2026-06-02', '2026-06-16');
  assert.equal(s.singleBeds, 0);
  assert.equal(s.doubleBeds, -1);
});
