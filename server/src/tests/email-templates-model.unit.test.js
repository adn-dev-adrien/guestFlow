// emailTemplatesModel CRUD + listEnabled. See specs/email-automation.md §4.1.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/emailTemplatesModel');

const DDL = `
  CREATE TABLE email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stableKey TEXT UNIQUE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    dayOffset INTEGER NOT NULL,
    sendMode TEXT NOT NULL DEFAULT 'manual',
    enabled INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

function fresh() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return { db, model: buildModel(db) };
}

test('insert: persists every field, stableKey stays null, returns the created row', () => {
  const { model } = fresh();
  const row = model.insert({ name: 'X', subject: 'S', body: 'B', dayOffset: -3, sendMode: 'manual', enabled: true });
  assert.equal(row.name, 'X');
  assert.equal(row.subject, 'S');
  assert.equal(row.dayOffset, -3);
  assert.equal(row.sendMode, 'manual');
  assert.equal(row.enabled, 1);
  assert.equal(row.stableKey, null, 'controller writes never set stableKey');
});

test('insert: sendMode coerced to "manual" on invalid input', () => {
  const { model } = fresh();
  const row = model.insert({ name: 'X', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'garbage' });
  assert.equal(row.sendMode, 'manual');
});

test('insert: enabled defaults to 1 when missing, accepts false', () => {
  const { model } = fresh();
  const def = model.insert({ name: 'X', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'auto' });
  assert.equal(def.enabled, 1);
  const off = model.insert({ name: 'Y', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'auto', enabled: false });
  assert.equal(off.enabled, 0);
});

test('list: sorted (dayOffset ASC, name ASC)', () => {
  const { model } = fresh();
  model.insert({ name: 'B', subject: 'S', body: 'B', dayOffset:  1, sendMode: 'manual' });
  model.insert({ name: 'A', subject: 'S', body: 'B', dayOffset:  1, sendMode: 'manual' });
  model.insert({ name: 'C', subject: 'S', body: 'B', dayOffset: -7, sendMode: 'manual' });
  const out = model.list().map((r) => r.name);
  assert.deepEqual(out, ['C', 'A', 'B']);
});

test('listEnabled: filters out disabled rows', () => {
  const { model } = fresh();
  model.insert({ name: 'On',  subject: 'S', body: 'B', dayOffset: -3, sendMode: 'auto', enabled: true });
  model.insert({ name: 'Off', subject: 'S', body: 'B', dayOffset: -3, sendMode: 'auto', enabled: false });
  const out = model.listEnabled().map((r) => r.name);
  assert.deepEqual(out, ['On']);
});

test('findByStableKey: returns the registry-seeded row when present', () => {
  const { db, model } = fresh();
  db.prepare(`INSERT INTO email_templates (stableKey, name, subject, body, dayOffset, sendMode, enabled)
              VALUES ('arrival_reminder_7d', 'X', 'S', 'B', -7, 'manual', 1)`).run();
  const row = model.findByStableKey('arrival_reminder_7d');
  assert.ok(row);
  assert.equal(row.name, 'X');
  assert.equal(model.findByStableKey('unknown'), undefined);
});

test('update: per-field 3-way — missing fields preserve current values', () => {
  const { model } = fresh();
  const created = model.insert({ name: 'X', subject: 'S0', body: 'B0', dayOffset: -3, sendMode: 'manual' });
  const after = model.update(created.id, { subject: 'S1' }); // only subject in payload
  assert.equal(after.subject, 'S1');
  assert.equal(after.body, 'B0', 'body untouched');
  assert.equal(after.name, 'X', 'name untouched');
  assert.equal(after.dayOffset, -3, 'dayOffset untouched');
});

test('update: enabled flag flips both ways', () => {
  const { model } = fresh();
  const r = model.insert({ name: 'X', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'auto' });
  assert.equal(r.enabled, 1);
  assert.equal(model.update(r.id, { enabled: false }).enabled, 0);
  assert.equal(model.update(r.id, { enabled: true  }).enabled, 1);
});

test('remove: returns true when a row was deleted, false on unknown id', () => {
  const { model } = fresh();
  const r = model.insert({ name: 'X', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'manual' });
  assert.equal(model.remove(r.id), true);
  assert.equal(model.remove(999999), false);
});

test('stableKey is UNIQUE: the constraint protects re-seeding from duplicates', () => {
  const { db } = fresh();
  db.prepare("INSERT INTO email_templates (stableKey, name, subject, body, dayOffset, sendMode) VALUES ('k', 'A', 'S', 'B', 0, 'manual')").run();
  assert.throws(
    () => db.prepare("INSERT INTO email_templates (stableKey, name, subject, body, dayOffset, sendMode) VALUES ('k', 'B', 'S', 'B', 0, 'manual')").run(),
    /UNIQUE/,
  );
});
