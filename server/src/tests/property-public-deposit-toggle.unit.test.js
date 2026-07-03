// Per-property « Acompte en ligne » toggle round-trip (specs/public-online-deposit.md §3 rule 1).
// FormData sends booleans as strings, so the model must coerce publicDepositEnabled to a 0/1 bit.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const propertiesModel = require('../models/propertiesModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function freshModel() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return { db, model: propertiesModel.buildModel(db) };
}

const readBit = (db, id) => db.prepare('SELECT publicDepositEnabled FROM properties WHERE id = ?').get(id).publicDepositEnabled;

test('create defaults publicDepositEnabled to 0 and stores 1 when opted in', async () => {
  const { db, model } = freshModel();
  const off = await model.create({ name: 'Sans acompte' });
  assert.equal(readBit(db, off.data ? off.data.id : off.id ?? db.prepare("SELECT id FROM properties WHERE name='Sans acompte'").get().id), 0);

  await model.create({ name: 'Avec acompte', publicDepositEnabled: 'true' });
  assert.equal(readBit(db, db.prepare("SELECT id FROM properties WHERE name='Avec acompte'").get().id), 1);
});

test('update coerces string/boolean/number forms to a 0/1 bit', async () => {
  const { db, model } = freshModel();
  await model.create({ name: 'Gite' });
  const id = db.prepare("SELECT id FROM properties WHERE name='Gite'").get().id;

  await model.update(id, { name: 'Gite', publicDepositEnabled: 'true' });
  assert.equal(readBit(db, id), 1);
  await model.update(id, { name: 'Gite', publicDepositEnabled: 'false' }); // "false" is a truthy string — must become 0
  assert.equal(readBit(db, id), 0);
  await model.update(id, { name: 'Gite', publicDepositEnabled: 1 });
  assert.equal(readBit(db, id), 1);
  await model.update(id, { name: 'Gite' }); // omitted → 0
  assert.equal(readBit(db, id), 0);
});
