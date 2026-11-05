// Shared fixtures for the guest-app suites (specs/guest-app.md). Not a test file. Far-future dates on purpose:
// the clock is injected and nothing here is compared with today.

const fs = require('fs');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');

const { applyPluginSchema } = require('../../sdk/testing');
const { buildGuestApi } = require('..');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'schema.sql'), 'utf8');

const paris = (ymd, time) => new Date(`${ymd}T${time}:00+02:00`);

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  const add = (table, column) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column.split(' ')[0])) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
    }
  };
  add('reservations', 'reservationNumber TEXT');
  add('clients', "emailLanguage TEXT NOT NULL DEFAULT 'fr'");
  applyPluginSchema(db, 'guest-app');
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'La Granja'), (2, 'L''Estiva')").run();
  db.prepare(`INSERT INTO clients (id, firstName, lastName, email, phone, address) VALUES
    (1, 'Marie', 'Le Goff-Durand', 'marie@example.test', '0600000000', '1 rue du Secret')`).run();
  return db;
}

function addStay(db, over = {}) {
  const row = {
    propertyId: 1, clientId: 1, startDate: '2099-07-06', endDate: '2099-07-09', checkInTime: '16:00', checkOutTime: '10:00',
    kind: 'reservation', reservationNumber: 'R-99-001', adults: 2, children: 1, teens: 0, babies: 0, ...over,
  };
  return db.prepare(`
    INSERT INTO reservations (propertyId, clientId, startDate, endDate, checkInTime, checkOutTime, kind, reservationNumber, adults, children, teens, babies)
    VALUES (@propertyId, @clientId, @startDate, @endDate, @checkInTime, @checkOutTime, @kind, @reservationNumber, @adults, @children, @teens, @babies)
  `).run(row).lastInsertRowid;
}

const passThrough = (req, res, next) => next();

/** The plugin's real routers on an in-memory database, with a clock the test moves. */
async function startApi(db, { soliomapUrl = 'https://soliomap.example.test', limiters = {} } = {}) {
  const clock = { now: paris('2099-07-07', '12:00') };
  const api = buildGuestApi({
    db: () => db,
    soliomapUrl: () => soliomapUrl,
    now: () => clock.now,
    limiters: { session: passThrough, lookup: passThrough, read: passThrough, ...limiters },
  });
  const app = express();
  app.use(express.json());
  app.use('/public/v1/guest', api.publicRouter);
  app.use('/api/guest-app', api.adminRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const cookies = { value: null };
  async function call(method, url, body, { cookie = cookies.value } = {}) {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookies.value = setCookie.split(';')[0];
    return { status: res.status, body: await res.json(), setCookie, headers: res.headers };
  }

  return { app, api, base, call, clock, cookies, close: () => new Promise((resolve) => { server.close(resolve); }) };
}

/** A lodging in the app, its code read straight from the table. */
function enable(api, db, propertyId = 1, patch = {}) {
  const models = require('../models/lodgingsModel')(db);
  models.save(propertyId, { enabled: true, ...patch });
  return db.prepare('SELECT lodgingCode FROM guest_app_lodgings WHERE propertyId = ?').get(propertyId).lodgingCode;
}

module.exports = { addStay, enable, freshDb, paris, startApi };
