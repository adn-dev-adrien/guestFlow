// specs/free-text-keeps-case.md rule 5 — a guest's name typed in one case gets a capital on every
// word and every part of a compound; a name typed in mixed case is kept as typed. « Jean-Pierre » no
// longer becomes « Jean-pierre », nor « Le Goff » « Le goff » (review of the website booking, 2026-10-18).
const test = require('node:test');
const assert = require('node:assert/strict');

const { personNameCase } = require('../utils/textFormatters');
const Database = require('better-sqlite3');

const CLIENTS = `CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lastName TEXT NOT NULL, firstName TEXT NOT NULL,
  streetNumber TEXT DEFAULT '', street TEXT DEFAULT '', postalCode TEXT DEFAULT '', city TEXT DEFAULT '',
  address TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '', notes TEXT DEFAULT '',
  emailLanguage TEXT NOT NULL DEFAULT 'fr', createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
);`;

test('rule 5: one case → each part capitalised', () => {
  assert.equal(personNameCase('jean-pierre'), 'Jean-Pierre');
  assert.equal(personNameCase('MARTIN-DUPONT'), 'Martin-Dupont');
  assert.equal(personNameCase('le goff'), 'Le Goff');
  assert.equal(personNameCase("d'arc"), "D'Arc");
  assert.equal(personNameCase('élodie'), 'Élodie');
});

test('rule 5: mixed case → kept as typed', () => {
  assert.equal(personNameCase('McDonald'), 'McDonald');
  assert.equal(personNameCase('Le Goff'), 'Le Goff');
  assert.equal(personNameCase('de La Fontaine'), 'de La Fontaine');
  assert.equal(personNameCase('Testeur WP'), 'Testeur WP');
});

test('rule 5: blank and spacing', () => {
  assert.equal(personNameCase(null), '');
  assert.equal(personNameCase('   '), '');
  assert.equal(personNameCase('  jean   pierre '), 'Jean Pierre');
});

test('rule 5: the client record stores names that way', () => {
  const db = new Database(':memory:');
  db.exec(CLIENTS);
  const model = require('../models/clientsModel').create(db);
  const c = model.insert({ firstName: 'jean-pierre', lastName: 'Le Goff', email: 'jp@example.com' });
  assert.equal(c.firstName, 'Jean-Pierre');
  assert.equal(c.lastName, 'Le Goff');
});
