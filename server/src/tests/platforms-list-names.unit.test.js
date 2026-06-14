const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const platformsModel = require('../models/platformsModel');

// specs/ical-platforms-in-dropdowns.md — `listNames()` is the single source the UI dropdowns read.
// It must:
//   - include the built-in well-known platforms even on an empty DB (no regression: the dropdowns
//     always offered Airbnb/Booking/… )
//   - include every name stored in the `platforms` table — which is topped up from iCal sources,
//     so a platform added in a logement's iCal imports surfaces in the dropdowns (the bug fixed)
//   - dedupe on the canonical form ('Airbnb' / 'airbnb' → one entry)
//   - put 'direct' first, then alphabetical

function freshModel() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE platforms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      commissionAccountNumber TEXT,
      hasVatOnCommission INTEGER NOT NULL DEFAULT 0, commissionPercent REAL NOT NULL DEFAULT 0
    );
  `);
  db.prepare("INSERT INTO platforms (name) VALUES ('direct')").run();
  return { db, model: platformsModel.create(db) };
}

test('empty DB (just direct): the built-in well-known platforms are still offered — regression', () => {
  const { db, model } = freshModel();
  const names = model.listNames();
  assert.equal(names[0], 'direct'); // direct first
  for (const known of ['Airbnb', 'Booking', 'Greengo', 'Abritel', 'Pitchup']) {
    assert.ok(names.includes(known), `expected built-in platform ${known} in the list`);
  }
  db.close();
});

test('a custom platform stored in the table (added via iCal import) shows up in the list — the bug', () => {
  const { db, model } = freshModel();
  // Simulates what propertyIcalModel.createSource does via platformsModel.upsertByName.
  model.upsertByName('Vrbo');
  const names = model.listNames();
  assert.ok(names.includes('Vrbo'), 'iCal-added platform must appear in the dropdown list');
  db.close();
});

test('dedupe on canonical form: a known platform already in the table is not duplicated', () => {
  const { db, model } = freshModel();
  db.prepare("INSERT INTO platforms (name) VALUES ('Airbnb')").run();
  const names = model.listNames();
  assert.equal(names.filter((n) => n.toLowerCase() === 'airbnb').length, 1);
  db.close();
});

test("'direct' is always first and appears exactly once", () => {
  const { db, model } = freshModel();
  model.upsertByName('Zenith');
  model.upsertByName('Alpha');
  const names = model.listNames();
  assert.equal(names[0], 'direct');
  assert.equal(names.filter((n) => n.toLowerCase() === 'direct').length, 1);
  db.close();
});

test('non-direct entries are sorted alphabetically (case-insensitive)', () => {
  const { db, model } = freshModel();
  model.upsertByName('Zenith');
  model.upsertByName('alpha');
  const names = model.listNames().filter((n) => n.toLowerCase() !== 'direct');
  const sorted = [...names].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
  assert.deepEqual(names, sorted);
  db.close();
});
