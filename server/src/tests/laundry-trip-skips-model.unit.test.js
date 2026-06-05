const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const laundryTripSkipsModel = require('../models/laundryTripSkipsModel');

// specs/skip-laundry-trip.md §7.1 — pure DB-access coverage for the skips model.

const DDL = `
  CREATE TABLE IF NOT EXISTS laundry_trip_skips (
    tripDate TEXT PRIMARY KEY NOT NULL CHECK (length(tripDate) = 10),
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return { model: laundryTripSkipsModel.create(db), db };
}

test('listAll is empty on a fresh DB', () => {
  const { model } = freshModel();
  assert.deepEqual(model.listAll(), []);
  assert.equal(model.count(), 0);
});

test('add is idempotent — second add of the same date returns false, count stays', () => {
  const { model } = freshModel();
  assert.equal(model.add('2026-06-09'), true);
  assert.equal(model.add('2026-06-09'), false);
  assert.equal(model.count(), 1);
  assert.deepEqual(model.listAll(), ['2026-06-09']);
});

test('remove is idempotent — removing a non-existent date returns false', () => {
  const { model } = freshModel();
  assert.equal(model.remove('2026-06-09'), false);
  model.add('2026-06-09');
  assert.equal(model.remove('2026-06-09'), true);
  assert.equal(model.remove('2026-06-09'), false);
  assert.equal(model.count(), 0);
});

test('isSkipped truthy iff the date is in the table', () => {
  const { model } = freshModel();
  assert.equal(model.isSkipped('2026-06-09'), false);
  model.add('2026-06-09');
  assert.equal(model.isSkipped('2026-06-09'), true);
  assert.equal(model.isSkipped('2026-06-16'), false);
});

test('listAll sorts ASC and PK enforces uniqueness at the DB layer (CHECK rejects bad shape)', () => {
  const { model, db } = freshModel();
  model.add('2026-06-23');
  model.add('2026-06-09');
  model.add('2026-06-16');
  assert.deepEqual(model.listAll(), ['2026-06-09', '2026-06-16', '2026-06-23']);
  // CHECK constraint: length must be 10 — a malformed insert at the raw SQL level fails.
  assert.throws(() => db.prepare('INSERT INTO laundry_trip_skips (tripDate) VALUES (?)').run('2026-6-9'),
    /CHECK constraint failed/);
});

test('model-level validation: non-ISO inputs throw a clear error', () => {
  const { model } = freshModel();
  assert.throws(() => model.add('2026/06/09'), /expected ISO date YYYY-MM-DD/);
  assert.throws(() => model.add('not-a-date'), /expected ISO date YYYY-MM-DD/);
  assert.throws(() => model.add(null),         /expected ISO date YYYY-MM-DD/);
  assert.throws(() => model.isSkipped(undefined), /expected ISO date YYYY-MM-DD/);
});
