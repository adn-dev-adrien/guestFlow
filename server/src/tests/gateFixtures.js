// Fixtures for the guest gate access tests (specs/guest-gate-access.md).
//
// The gate tables come from utils/gateSchema.js — the very DDL production runs — so a column that
// changes there breaks these tests instead of quietly passing against an old shape. Only the
// `reservations` columns the feature actually reads are declared, and nothing else of the app is
// loaded: no database.js, no server.

const Database = require('better-sqlite3');
const { GATE_SCHEMA_SQL } = require('../utils/gateSchema');

const RESERVATIONS_SQL = `
  CREATE TABLE reservations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    propertyId    INTEGER NOT NULL DEFAULT 1,
    clientId      INTEGER NOT NULL DEFAULT 1,
    startDate     TEXT NOT NULL,
    endDate       TEXT NOT NULL,
    checkInTime   TEXT DEFAULT '15:00',
    checkOutTime  TEXT DEFAULT '10:00',
    kind          TEXT NOT NULL DEFAULT 'reservation',
    cancelledAt   TEXT
  );
`;

/** An in-memory database carrying the gate tables and a minimal `reservations`. */
function makeGateDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(RESERVATIONS_SQL);
  db.exec(GATE_SCHEMA_SQL);
  return db;
}

/** Inserts a stay and returns its id. Defaults to a two-night September stay at property 1. */
function insertStay(db, over = {}) {
  const row = {
    propertyId: 1,
    startDate: '2026-09-12',
    endDate: '2026-09-14',
    checkInTime: '16:00',
    checkOutTime: '10:00',
    kind: 'reservation',
    cancelledAt: null,
    ...over,
  };
  const info = db.prepare(`
    INSERT INTO reservations (propertyId, clientId, startDate, endDate, checkInTime, checkOutTime, kind, cancelledAt)
    VALUES (@propertyId, 1, @startDate, @endDate, @checkInTime, @checkOutTime, @kind, @cancelledAt)
  `).run(row);
  return Number(info.lastInsertRowid);
}

/**
 * A model wired to that database with a movable clock.
 * `clock.set(iso)` moves time for every call that defaults to `now`.
 */
function makeModel(db, startIso = '2026-09-12T17:00:00.000Z', { generateCode } = {}) {
  const clock = {
    at: new Date(startIso),
    set(iso) { clock.at = new Date(iso); return clock.at; },
    advance(ms) { clock.at = new Date(clock.at.getTime() + ms); return clock.at; },
  };
  const model = require('../models/gateAccessModel')
    .create(db, { now: () => clock.at, generateCode });
  return { model, clock };
}

module.exports = { makeGateDb, insertStay, makeModel };
