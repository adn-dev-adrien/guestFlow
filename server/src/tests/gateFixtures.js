// Fixtures for the guest gate access tests (specs/guest-gate-access.md).
//
// The gate tables come from utils/gateSchema.js — the very DDL production runs — so a column that
// changes there breaks these tests instead of quietly passing against an old shape. Only the
// `reservations` columns the feature actually reads are declared, and nothing else of the app is
// loaded: no database.js, no server.

const Database = require('better-sqlite3');
const Module = require('module');
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

/**
 * Swaps modules out of `require` for the duration of `fn` — the technique already used by
 * sas-departure-mode.unit.test.js. It is what lets a controller be tested against an in-memory
 * database instead of the real file: the controller imports the default model instance, and a
 * default instance cannot be injected any other way.
 */
function withMocks(modules, fn) {
  const original = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return original.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = original; }
}

/** An express-shaped response that records what the controller did to it. */
function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    /** 204s call `.end()` with no body — the poller's result route does. */
    end(body = null) { this.body = body; this.ended = true; return this; },
    append(name, value) {
      const key = name.toLowerCase();
      this.headers[key] = this.headers[key] ? [].concat(this.headers[key], value) : value;
      return this;
    },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    /** The Set-Cookie the guest's browser would keep, as a bare `name=value`. */
    cookie() {
      const raw = [].concat(this.headers['set-cookie'] || []).find(Boolean);
      return raw ? String(raw).split(';')[0] : null;
    },
  };
}

function fakeReq({ body = {}, cookie = null, ip = '203.0.113.7', params = {}, host = 'guest.test' } = {}) {
  const headers = { host, 'user-agent': 'iPhone; test' };
  if (cookie) headers.cookie = cookie;
  return {
    body,
    params,
    ip,
    headers,
    isGuestHost: true,
    socket: { remoteAddress: ip },
    get(name) { return headers[String(name).toLowerCase()]; },
  };
}

/**
 * The guest controller, wired to an in-memory database. `queue` is a spy so a test can prove that a
 * press wakes a poller — and, just as importantly, that a deduplicated press does not.
 */
function loadGuestController({ db, model, phone = '06.15.73.93.37' } = {}) {
  const queue = { notified: 0, notify() { queue.notified += 1; return true; }, waitForWork: async () => null, drain: () => 0, pendingCount: () => 0 };
  const controller = withMocks({
    '../database': db,
    '../models/gateAccessModel': model,
    '../models/settingsModel': { read: () => ({ companyPhone: phone }) },
    '../utils/gateQueue': queue,
  }, () => {
    delete require.cache[require.resolve('../controllers/guestGateController')];
    return require('../controllers/guestGateController');
  });
  delete require.cache[require.resolve('../controllers/guestGateController')];
  return { controller, queue };
}

/**
 * The poller controller, wired to an in-memory database. The queue is left REAL here: the wake-up
 * is the behaviour under test, and a spy would only prove the spy works.
 */
function loadPollerController({ db, model } = {}) {
  const controller = withMocks({
    '../database': db,
    '../models/gateAccessModel': model,
  }, () => {
    delete require.cache[require.resolve('../controllers/gatePollerController')];
    return require('../controllers/gatePollerController');
  });
  delete require.cache[require.resolve('../controllers/gatePollerController')];
  return controller;
}

/** A request shaped for the poller routes: query, params, and the key headers. */
function fakePollerReq({ query = {}, params = {}, body = {}, key = null } = {}) {
  const headers = { host: 'guestflow.test' };
  if (key) headers.authorization = `Bearer ${key}`;
  return {
    query, params, body, headers, ip: '192.168.0.26',
    socket: { remoteAddress: '192.168.0.26' },
    get(name) { return headers[String(name).toLowerCase()]; },
  };
}

module.exports = {
  makeGateDb,
  insertStay,
  makeModel,
  withMocks,
  fakeRes,
  fakeReq,
  loadGuestController,
  loadPollerController,
  fakePollerReq,
};
