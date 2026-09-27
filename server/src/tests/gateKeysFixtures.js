// Shared fixtures for the gate-keys suites (specs/gate-access-sowel-connector.md). Not a test file:
// a suite imports it without re-running another suite.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { createGateKeysModel } = require('../models/gateKeysModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  // Added by a guarded migration in database.js, not by the baseline.
  const columns = db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name);
  if (!columns.includes('reservationNumber')) db.exec('ALTER TABLE reservations ADD COLUMN reservationNumber TEXT');
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (2, 'Lodge')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Marie', 'Durand')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (2, 'Paul', 'Martin')").run();
  return { db, model: createGateKeysModel(db) };
}

let nextId = 100;
function addStay(db, over = {}) {
  const row = {
    id: nextId++,
    propertyId: 1,
    clientId: 1,
    startDate: '2026-10-01',
    endDate: '2026-10-04',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    kind: 'reservation',
    reservationNumber: null,
    ...over,
  };
  if (row.reservationNumber === null) row.reservationNumber = `R-2026-${String(row.id).padStart(3, '0')}`;
  db.prepare(`
    INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, checkInTime, checkOutTime, kind, reservationNumber)
    VALUES (@id, @propertyId, @clientId, @startDate, @endDate, @checkInTime, @checkOutTime, @kind, @reservationNumber)
  `).run(row);
  return row;
}

function addUser(db, { id, roles, isActive = 1 }) {
  db.prepare('INSERT INTO users (id, email, passwordHash, isActive) VALUES (?, ?, ?, ?)')
    .run(id, `user${id}@example.com`, 'x', isActive);
  for (const role of roles) db.prepare('INSERT INTO user_roles (userId, role) VALUES (?, ?)').run(id, role);
}

/** A pushService double recording every call; every user has one device. */
function fakePush() {
  const calls = [];
  return {
    calls,
    async sendToUser(userId, payload) {
      calls.push({ userId, payload });
      return { sent: 1, pruned: 0, failed: 0 };
    },
  };
}

const silent = { warn() {}, error() {}, log() {} };

module.exports = { freshDb, addStay, addUser, fakePush, silent };
