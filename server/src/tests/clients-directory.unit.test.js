// specs/clients-upcoming-past-directory.md — the Clients page read: bucket per client, the stay that
// qualifies it, the per-bucket counts of the search, and the ordering. All server-side (issue #19).

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const clientsModel = require('../models/clientsModel');

const today = new Date().toISOString().slice(0, 10);
const shift = (days) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function makeModel() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lastName TEXT, firstName TEXT, streetNumber TEXT, street TEXT,
      postalCode TEXT, city TEXT, address TEXT, phone TEXT, email TEXT, notes TEXT,
      createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT, finalPrice REAL DEFAULT 0,
      adults INTEGER DEFAULT 0, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
      devisNumber TEXT, devisStatus TEXT
    );
  `);
  const addClient = (lastName, firstName, extra = {}) => db.prepare(
    'INSERT INTO clients (lastName, firstName, email, phone, city) VALUES (?, ?, ?, ?, ?)',
  ).run(lastName, firstName, extra.email || '', extra.phone || '', extra.city || '').lastInsertRowid;
  const addStay = (clientId, startDate, endDate, kind = 'reservation') => db.prepare(
    'INSERT INTO reservations (kind, clientId, startDate, endDate) VALUES (?, ?, ?, ?)',
  ).run(kind, clientId, startDate, endDate);
  return { model: clientsModel.create(db), addClient, addStay };
}

const byName = (items) => items.map((c) => c.lastName);
const find = (res, lastName) => res.items.find((c) => c.lastName === lastName);

test('a client with a future stay is « à venir », dated on that stay', () => {
  const { model, addClient, addStay } = makeModel();
  const id = addClient('Futur', 'Alice');
  addStay(id, shift(10), shift(12));
  const res = model.directory({ bucket: 'upcoming' });
  assert.equal(find(res, 'Futur').bucket, 'upcoming');
  assert.equal(find(res, 'Futur').stayDate, shift(10));
});

test('a stay in progress keeps the client « à venir » (they are still in the house)', () => {
  const { model, addClient, addStay } = makeModel();
  const id = addClient('Encours', 'Bob');
  addStay(id, shift(-2), shift(2));
  assert.equal(find(model.directory({ bucket: 'upcoming' }), 'Encours').bucket, 'upcoming');
  // A stay ending TODAY still counts (endDate >= today).
  const id2 = addClient('Cejour', 'Carla');
  addStay(id2, shift(-3), today);
  assert.equal(find(model.directory({ bucket: 'upcoming' }), 'Cejour').bucket, 'upcoming');
});

test('with both a past and a future stay, the FUTURE date wins (issue #19)', () => {
  const { model, addClient, addStay } = makeModel();
  const id = addClient('Fidele', 'Denis');
  addStay(id, shift(-400), shift(-395));
  addStay(id, shift(30), shift(33));
  const row = find(model.directory({ bucket: 'upcoming' }), 'Fidele');
  assert.equal(row.bucket, 'upcoming');
  assert.equal(row.stayDate, shift(30));
});

test('only past stays → « passés », dated on the LAST one', () => {
  const { model, addClient, addStay } = makeModel();
  const id = addClient('Ancien', 'Eve');
  addStay(id, shift(-400), shift(-395));
  addStay(id, shift(-40), shift(-38));
  const row = find(model.directory({ bucket: 'past' }), 'Ancien');
  assert.equal(row.bucket, 'past');
  assert.equal(row.stayDate, shift(-40));
  assert.equal(model.directory({ bucket: 'upcoming' }).items.length, 0);
});

test('no stay at all → « à venir » with no date; a devis is not a stay', () => {
  const { model, addClient, addStay } = makeModel();
  addClient('Sansejour', 'Fanny');
  const id = addClient('Devisseul', 'Gerard');
  addStay(id, shift(20), shift(22), 'devis');
  const res = model.directory({ bucket: 'upcoming' });
  assert.equal(find(res, 'Sansejour').stayDate, null);
  assert.equal(find(res, 'Devisseul').bucket, 'upcoming');
  assert.equal(find(res, 'Devisseul').stayDate, null, 'a quote does not date a client');
});

test('counts describe the searched set, whatever bucket is asked for', () => {
  const { model, addClient, addStay } = makeModel();
  const a = addClient('Futur', 'Alice', { city: 'Lyon' });
  addStay(a, shift(5), shift(7));
  const b = addClient('Ancien', 'Bob', { city: 'Lyon' });
  addStay(b, shift(-30), shift(-28));
  const c = addClient('Ailleurs', 'Chloe', { city: 'Paris' });
  addStay(c, shift(-10), shift(-8));

  const all = model.directory({ bucket: 'upcoming' });
  assert.deepEqual(all.counts, { upcoming: 1, past: 2 });
  const lyon = model.directory({ q: 'Lyon', bucket: 'past' });
  assert.deepEqual(lyon.counts, { upcoming: 1, past: 1 }, 'the search applies before the split');
  assert.deepEqual(byName(lyon.items), ['Ancien']);
});

test('sorting: by stay date both ways, by name accent-aware, and no-date clients last', () => {
  const { model, addClient, addStay } = makeModel();
  const soon = addClient('Bernard', 'Zoe');
  addStay(soon, shift(3), shift(4));
  const later = addClient('Alard', 'Yves');
  addStay(later, shift(20), shift(22));
  addClient('Élodie', 'Xavier'); // no stay → always last on a date sort

  assert.deepEqual(byName(model.directory({ bucket: 'upcoming', sort: 'stayDate', dir: 'asc' }).items),
    ['Bernard', 'Alard', 'Élodie']);
  assert.deepEqual(byName(model.directory({ bucket: 'upcoming', sort: 'stayDate', dir: 'desc' }).items),
    ['Alard', 'Bernard', 'Élodie'], 'a client with no date is never « the smallest »');
  assert.deepEqual(byName(model.directory({ bucket: 'upcoming', sort: 'lastName', dir: 'asc' }).items),
    ['Alard', 'Bernard', 'Élodie'], 'É sorts with E in French');
  assert.deepEqual(byName(model.directory({ bucket: 'upcoming', sort: 'firstName', dir: 'asc' }).items),
    ['Élodie', 'Alard', 'Bernard']);
});

test('defaults: « à venir » lists the soonest first, « passés » the most recent first', () => {
  const { model, addClient, addStay } = makeModel();
  const soon = addClient('Proche', 'A');
  addStay(soon, shift(3), shift(4));
  const later = addClient('Lointain', 'B');
  addStay(later, shift(40), shift(42));
  const old = addClient('Vieux', 'C');
  addStay(old, shift(-300), shift(-298));
  const recent = addClient('Recent', 'D');
  addStay(recent, shift(-10), shift(-8));

  assert.deepEqual(byName(model.directory({}).items), ['Proche', 'Lointain']);
  assert.deepEqual(byName(model.directory({ bucket: 'past' }).items), ['Recent', 'Vieux']);
});

test('an unknown sort / direction falls back to the defaults instead of failing', () => {
  const { model, addClient, addStay } = makeModel();
  const id = addClient('Test', 'A');
  addStay(id, shift(5), shift(6));
  const res = model.directory({ bucket: 'bogus', sort: 'notes; DROP TABLE clients', dir: 'sideways' });
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].bucket, 'upcoming');
});
