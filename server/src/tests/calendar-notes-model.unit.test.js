const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const calendarNotesModel = require('../models/calendarNotesModel');

function freshModel() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE calendar_notes (propertyId INTEGER, date TEXT, note TEXT, PRIMARY KEY (propertyId, date));');
  return { db, model: calendarNotesModel.buildModel(db) };
}

test('upsert inserts then updates; list filters by range', () => {
  const { model } = freshModel();
  const saved = model.upsert(1, '2026-07-10', 'arrivée tardive');
  assert.equal(saved.note, 'Arrivée tardive'); // sentenceCase
  model.upsert(1, '2026-07-12', 'ménage');
  model.upsert(2, '2026-07-10', 'autre logement');

  assert.equal(model.listForProperty(1).length, 2);
  assert.equal(model.listForProperty(1, { from: '2026-07-11', to: '2026-07-31' }).length, 1);

  const updated = model.upsert(1, '2026-07-10', 'changé');
  assert.equal(updated.note, 'Changé');
  assert.equal(model.listForProperty(1).length, 2); // still 2 (upsert, not insert)
});

test('an empty note deletes the row; remove deletes', () => {
  const { model } = freshModel();
  model.upsert(1, '2026-07-10', 'note');
  assert.deepEqual(model.upsert(1, '2026-07-10', '   '), { deleted: true });
  assert.equal(model.listForProperty(1).length, 0);

  model.upsert(1, '2026-07-11', 'note2');
  assert.deepEqual(model.remove(1, '2026-07-11'), { deleted: true });
  assert.equal(model.listForProperty(1).length, 0);
});

test('note is capped at 50 characters', () => {
  const { model } = freshModel();
  const long = 'a'.repeat(80);
  const saved = model.upsert(1, '2026-07-10', long);
  assert.equal(saved.note.length, 50);
});
