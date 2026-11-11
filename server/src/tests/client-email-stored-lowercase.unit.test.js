process.env.DB_PATH = ':memory:';
// specs/clients.md rule 12 (reading of 2026-11-05, audit R23 public finding 4): SQLite's lower() is ASCII only, so an
// address holding a non-ASCII character is stored in JS lower case, by every writer: the JS key and lower(email) then agree.
// An ASCII address keeps its case.
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const clientsModel = require('../models/clientsModel');
const { storedEmail } = require('../utils/emailAddress');

test('storedEmail — lower case only when the address holds a non-ASCII character', () => {
  assert.equal(storedEmail('  ÉMILIE@Example.TEST '), 'émilie@example.test');
  assert.equal(storedEmail('USER@例子.TEST'), 'user@例子.test');
  assert.equal(storedEmail(' ANNA@Example.test '), 'ANNA@Example.test');
  assert.equal(storedEmail(''), '');
  assert.equal(storedEmail(null), '');
  assert.equal(storedEmail(undefined), '');
});

test('rule 12 — insert and update store the same key findByEmail and lower() read', () => {
  const created = clientsModel.insert({ firstName: 'Zoé', lastName: 'Martin', email: 'ÉLODIE@Example.test', phone: '0612345678' });
  assert.equal(created.email, 'élodie@example.test');
  assert.equal(clientsModel.findByEmail('ÉLODIE@EXAMPLE.TEST').id, created.id);
  assert.equal(clientsModel.findDuplicate({ email: 'Élodie@example.test' }).id, created.id);
  assert.equal(db.prepare('SELECT id FROM clients WHERE lower(trim(email)) = ?').get('élodie@example.test').id, created.id);

  const updated = clientsModel.update(created.id, { ...created, email: 'ÉLISE@Example.test' });
  assert.equal(updated.email, 'élise@example.test');
  assert.equal(clientsModel.findByEmail('ÉLISE@example.test').id, created.id);
});

test('rule 12 — an ASCII address keeps what was typed', () => {
  const created = clientsModel.insert({ firstName: 'Zoé', lastName: 'Martin', email: 'CAPS@Example.test', phone: '0612345679' });
  assert.equal(created.email, 'CAPS@Example.test');
  assert.equal(clientsModel.findByEmail('caps@example.test').id, created.id);
});
