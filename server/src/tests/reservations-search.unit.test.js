const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');

// specs/reservation-number-and-search.md §3 rules 8-9 — live "jump to a reservation" search.
// Matching + shaping + cap are all server-side (fat backend).

const DDL = `
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, email TEXT);
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    reservationNumber TEXT, propertyId INTEGER, clientId INTEGER, startDate TEXT, endDate TEXT
  );
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte du Lac')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean.dupont@example.com')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (2, 'Marie', 'Martin', 'marie.martin@example.com')").run();
  return { db, model: reservationsModel.create(db) };
}

function addRes(db, { kind = 'reservation', reservationNumber = null, clientId = 1, startDate = '2026-07-10', endDate = '2026-07-13' }) {
  return db.prepare(
    "INSERT INTO reservations (kind, reservationNumber, propertyId, clientId, startDate, endDate) VALUES (?, ?, 1, ?, ?, ?)",
  ).run(kind, reservationNumber, clientId, startDate, endDate).lastInsertRowid;
}

test('blank query returns []', () => {
  const { db, model } = freshModel();
  addRes(db, { reservationNumber: '2026-07-001' });
  assert.deepEqual(model.search({ q: '' }), []);
  assert.deepEqual(model.search({ q: '   ' }), []);
  assert.deepEqual(model.search({}), []);
});

test('matches by reservation number (fragment)', () => {
  const { db, model } = freshModel();
  const id = addRes(db, { reservationNumber: '2026-07-042' });
  const rows = model.search({ q: '07-04' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id);
  assert.deepEqual(rows[0], {
    id, reservationNumber: '2026-07-042', clientFullName: 'Jean Dupont',
    propertyName: 'Gîte du Lac', startDate: '2026-07-10', endDate: '2026-07-13',
  });
});

test('matches by first name, last name, and both orders (case-insensitive)', () => {
  const { db, model } = freshModel();
  const id = addRes(db, { reservationNumber: '2026-07-001', clientId: 1 }); // Jean Dupont
  assert.equal(model.search({ q: 'jean' })[0].id, id);
  assert.equal(model.search({ q: 'DUPONT' })[0].id, id);
  assert.equal(model.search({ q: 'jean dupont' })[0].id, id);
  assert.equal(model.search({ q: 'dupont jean' })[0].id, id);
});

test('matches by email (fragment, case-insensitive)', () => {
  const { db, model } = freshModel();
  const id = addRes(db, { reservationNumber: '2026-07-001', clientId: 1 }); // jean.dupont@example.com
  assert.equal(model.search({ q: 'jean.dupont@example.com' })[0].id, id);
  assert.equal(model.search({ q: 'JEAN.DUPONT@EXAMPLE' })[0].id, id);
  assert.equal(model.search({ q: '@example.com' }).length, 1); // only client 1 has a reservation
  assert.equal(model.search({ q: 'marie.martin' }).length, 0); // client 2 has no reservation
});

test('does not match an unrelated client', () => {
  const { db, model } = freshModel();
  addRes(db, { reservationNumber: '2026-07-001', clientId: 1 }); // Jean Dupont
  assert.equal(model.search({ q: 'martin' }).length, 0);
});

test('excludes devis (kind="devis")', () => {
  const { db, model } = freshModel();
  addRes(db, { kind: 'devis', reservationNumber: null, clientId: 1 });
  assert.equal(model.search({ q: 'dupont' }).length, 0);
});

test('orders by startDate DESC and caps at 20', () => {
  const { db, model } = freshModel();
  for (let i = 0; i < 25; i += 1) {
    const day = String(10 + (i % 18)).padStart(2, '0');
    addRes(db, { reservationNumber: `2026-07-${String(i + 1).padStart(3, '0')}`, clientId: 1, startDate: `2026-07-${day}`, endDate: '2026-08-01' });
  }
  const rows = model.search({ q: 'dupont' });
  assert.equal(rows.length, 20, 'capped at 20');
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i - 1].startDate >= rows[i].startDate, 'DESC by startDate');
  }
});

test('null reservationNumber is shaped as empty string', () => {
  const { db, model } = freshModel();
  addRes(db, { reservationNumber: null, clientId: 1 });
  const rows = model.search({ q: 'jean' });
  assert.equal(rows[0].reservationNumber, '');
});
