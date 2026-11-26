// specs/site/site-outside-resource-booking.md rule 25 — `resources.sessionMaxPeople`, the most people in one session booked from the website: set on the resource, NULL for every
// existing row (the stepper then allows 20), a whole number from 1 to 100 on its own field, a value already stored not judged again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const resourcesController = require('../controllers/resourcesController');
const resourcesModel = require('../models/resourcesModel');

const schemaDb = () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  return db;
};

test('rule 25 — the column exists in the baseline schema, NULL by default', () => {
  const db = schemaDb();
  const column = db.prepare('PRAGMA table_info(resources)').all().find((c) => c.name === 'sessionMaxPeople');
  assert.deepEqual([column.type, column.notnull, column.dflt_value], ['INTEGER', 0, null]);
  db.prepare("INSERT INTO resources (name, priceType, price, quantity) VALUES ('Bain', 'per_hour', 30, 1)").run();
  assert.equal(db.prepare('SELECT sessionMaxPeople FROM resources').get().sessionMaxPeople, null);
});

test('rule 25 — the resource model stores it, reads it back, and stores NULL when it is emptied', () => {
  const model = resourcesModel.create(schemaDb());
  const id = model.insert({
    name: 'Bain', priceType: 'per_hour', price: 30, quantity: 1, sessionMaxPeople: '8',
  });
  assert.equal(model.findById(id).sessionMaxPeople, 8);
  model.update(id, {
    name: 'Bain', priceType: 'per_hour', price: 30, quantity: 1, sessionMaxPeople: '',
  });
  assert.equal(model.findById(id).sessionMaxPeople, null);
});

test('rule 25 — the resource form refuses a party outside 1-100 on its own field and keeps one it already stores', () => {
  let stored = null;
  const model = { insert: () => 1, update: () => {}, findById: () => stored };
  const controller = resourcesController.buildController(model, { isOffered: () => true, properties: () => [] });
  const base = { name: 'Bain', priceType: 'per_stay', price: 10, quantity: 1 };
  const answer = (extra, current = null) => {
    stored = current;
    let out;
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { out = { status: this.statusCode, body: b }; return this; } };
    if (current) controller.update({ query: {}, params: { id: 1 }, body: { ...base, ...extra } }, res);
    else controller.create({ query: {}, params: {}, body: { ...base, ...extra } }, res);
    return out;
  };
  [{}, { sessionMaxPeople: 8 }, { sessionMaxPeople: '100' }, { sessionMaxPeople: null }, { sessionMaxPeople: '' }].forEach((ok) => assert.equal(answer(ok).status, 200, JSON.stringify(ok)));
  [0, 101, 2.5, 'beaucoup'].forEach((bad) => {
    const refused = answer({ sessionMaxPeople: bad });
    assert.equal(refused.status, 422, String(bad));
    assert.deepEqual(refused.body.details, [{ field: 'sessionMaxPeople', message: 'Nombre entier de personnes entre 1 et 100' }]);
  });
  assert.equal(answer({ sessionMaxPeople: 150 }, { ...base, sessionMaxPeople: 150 }).status, 200, 'a value already stored is not judged again');
});
