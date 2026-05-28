const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const clientsModel = require('../models/clientsModel');

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lastName TEXT NOT NULL,
    firstName TEXT NOT NULL,
    streetNumber TEXT DEFAULT '',
    street TEXT DEFAULT '',
    postalCode TEXT DEFAULT '',
    city TEXT DEFAULT '',
    address TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'reservation',
    devisNumber TEXT, devisStatus TEXT,
    clientId INTEGER,
    propertyId INTEGER,
    startDate TEXT, endDate TEXT, platform TEXT, finalPrice REAL,
    adults INTEGER DEFAULT 0, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0
  );
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO properties (id, name) VALUES (?, ?)').run(1, 'Villa A');
  return { model: clientsModel.create(db), db };
}

function addReservation(db, clientId, startDate, endDate, extra = {}) {
  return db.prepare(`
    INSERT INTO reservations (clientId, propertyId, startDate, endDate, platform, finalPrice, adults, children, teens, babies)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(clientId, startDate, endDate, extra.platform || 'direct', extra.finalPrice || 0,
    extra.adults || 0, extra.children || 0, extra.teens || 0, extra.babies || 0);
}

function addDevis(db, clientId, startDate, endDate, extra = {}) {
  return db.prepare(`
    INSERT INTO reservations (kind, clientId, propertyId, devisNumber, devisStatus, startDate, endDate, finalPrice)
    VALUES ('devis', ?, 1, ?, ?, ?, ?, ?)
  `).run(clientId, extra.devisNumber || 'D-1', extra.status || 'draft', startDate, endDate, extra.finalPrice || 0);
}

// ---------- create / normalization ----------

test('insert normalizes names, keeps a single phone, computes address from number+street', () => {
  const { model } = freshModel();
  const c = model.insert({
    lastName: 'DUPONT', firstName: 'jean', streetNumber: '12', street: 'rue des fleurs',
    postalCode: '75001', city: 'paris', phone: ' 0612345678 ', email: 'a@b.fr', notes: 'vip',
  });
  assert.equal(c.lastName, 'Dupont');
  assert.equal(c.firstName, 'Jean');
  assert.equal(c.street, 'Rue des fleurs');
  assert.equal(c.city, 'Paris');
  assert.equal(c.phone, '0612345678');
  assert.equal(c.address, '12 Rue des fleurs');
  assert.equal(c.phoneNumbers, undefined); // single-phone model: no array
});

test('explicit address is kept over the computed one', () => {
  const { model } = freshModel();
  const c = model.insert({ lastName: 'a', firstName: 'b', streetNumber: '5', street: 'rue x', address: 'BP 42' });
  assert.equal(c.address, 'Bp 42');
});

// ---------- update ----------

test('update changes the stored phone and names', () => {
  const { model } = freshModel();
  const c = model.insert({ lastName: 'a', firstName: 'b', phone: '0611111111' });
  const updated = model.update(c.id, { lastName: 'martin', firstName: 'lea', phone: '0799999999' });
  assert.equal(updated.lastName, 'Martin');
  assert.equal(updated.phone, '0799999999');
  assert.equal(model.findById(c.id).phone, '0799999999');
});

// ---------- search ----------

test('list(q) matches name, email and phone', () => {
  const { model } = freshModel();
  model.insert({ lastName: 'Durand', firstName: 'Paul', email: 'paul@mail.fr', phone: '0612345678' });
  model.insert({ lastName: 'Other', firstName: 'Zoe', email: 'zoe@mail.fr', phone: '0700000000' });
  assert.equal(model.list('durand').length, 1);
  assert.equal(model.list('paul@mail').length, 1);
  assert.equal(model.list('0612').length, 1);
  assert.equal(model.list('mail.fr').length, 2);
});

// ---------- delete impact ----------

test('getDeleteImpact returns reservations (upcoming first, past last) with nights, plus devis', () => {
  const { model, db } = freshModel();
  const c = model.insert({ lastName: 'a', firstName: 'b' });
  addReservation(db, c.id, '2020-01-01', '2020-01-05'); // past, 4 nights
  addReservation(db, c.id, '2099-06-01', '2099-06-04'); // future, 3 nights
  addDevis(db, c.id, '2099-07-01', '2099-07-03', { devisNumber: 'D-9' });

  const impact = model.getDeleteImpact(c.id);
  assert.equal(impact.reservationsCount, 2);
  assert.equal(impact.reservations[0].startDate, '2099-06-01'); // upcoming first
  assert.equal(impact.reservations[0].nights, 3);
  assert.equal(impact.reservations[1].startDate, '2020-01-01'); // past last
  assert.equal(impact.reservations[1].nights, 4);
  assert.equal(impact.reservations[0].propertyName, 'Villa A');
  assert.equal(impact.devisCount, 1);
  assert.equal(impact.devis[0].devisNumber, 'D-9');
  assert.equal(impact.devis[0].nights, 2);
});

test('getDeleteImpact returns null for a missing client', () => {
  const { model } = freshModel();
  assert.equal(model.getDeleteImpact(999), null);
});

// ---------- cleanup orphans ----------

test('cleanupOrphans deletes clients with no reservation and no devis, keeps devis-only clients', () => {
  const { model, db } = freshModel();
  const orphan = model.insert({ lastName: 'orphan', firstName: 'x' });
  const withRes = model.insert({ lastName: 'withres', firstName: 'y' });
  const withDevis = model.insert({ lastName: 'withdevis', firstName: 'z' });
  addReservation(db, withRes.id, '2099-01-01', '2099-01-02');
  addDevis(db, withDevis.id, '2099-02-01', '2099-02-02');

  const result = model.cleanupOrphans();
  assert.equal(result.deletedCount, 1);
  assert.equal(result.keptWithDevisCount, 1);
  assert.equal(model.findById(orphan.id), undefined);
  assert.ok(model.findById(withRes.id));
  assert.ok(model.findById(withDevis.id));
});
