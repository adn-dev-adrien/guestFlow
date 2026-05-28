const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const icalModel = require('../models/icalModel');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT, platform TEXT, adults INTEGER, children INTEGER
  );
  CREATE TABLE ical_tokens (propertyId INTEGER, token TEXT);
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Real', 'Booking', 'real@x.fr'), (2, 'Quote', 'Devis', 'quote@x.fr')").run();
  db.prepare("INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, adults, children) VALUES ('reservation', 1, 1, '2026-07-10', '2026-07-13', 'airbnb', 2, 0)").run();
  db.prepare("INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, adults, children) VALUES ('devis', 1, 2, '2026-07-20', '2026-07-25', 'direct', 2, 0)").run();
  return { db, model: icalModel.buildModel(db) };
}

test('exportProperty includes real reservations but NEVER a devis (the fusion fix)', () => {
  const { model } = freshModel();
  const ics = model.exportProperty(1);
  const eventCount = (ics.match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(eventCount, 1); // only the kind='reservation' row
  assert.ok(ics.includes('Real Booking'));
  assert.ok(!ics.includes('Quote Devis'), 'a devis must not appear in the public iCal feed');
});

test('exportProperty returns null for an unknown property', () => {
  const { model } = freshModel();
  assert.equal(model.exportProperty(999), null);
});

test('token: get-or-create is stable; regenerate replaces; lookup by token', () => {
  const { model } = freshModel();
  const t1 = model.getOrCreateToken(1);
  assert.ok(t1 && t1.length > 0);
  assert.equal(model.getOrCreateToken(1), t1); // stable

  const t2 = model.regenerateToken(1);
  assert.notEqual(t2, t1);
  assert.equal(model.findPropertyIdByToken(t2), 1);
  assert.equal(model.findPropertyIdByToken(t1), null); // old token gone
  assert.equal(model.findPropertyIdByToken('nope'), null);
});
