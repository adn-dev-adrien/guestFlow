// Shared fixtures for the guest-app suites (specs/guest-app.md). Not a test file. Far-future dates on purpose:
// the clock is injected and nothing here is compared with today.

const fs = require('fs');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');

const { applyPluginSchema } = require('../../sdk/testing');
const { forLang } = require('../../../utils/translationResolver');
const translationsModel = require('../../../models/translationsModel');
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
    kind: 'reservation', reservationNumber: 'R-99-001', adults: 2, children: 1, teens: 0, babies: 0, platform: 'direct', checkInDone: 1, ...over,
  };
  // `checkInDone` defaults to the arrival marked: the shop and the orders of a stay session read where the core collects
  // an order (specs/guest-app.md rule 67); the suites of the pre-arrival orders mark it off.
  return db.prepare(`
    INSERT INTO reservations (propertyId, clientId, startDate, endDate, checkInTime, checkOutTime, kind, reservationNumber, adults, children, teens, babies, platform, checkInDone)
    VALUES (@propertyId, @clientId, @startDate, @endDate, @checkInTime, @checkOutTime, @kind, @reservationNumber, @adults, @children, @teens, @babies, @platform, @checkInDone)
  `).run(row).lastInsertRowid;
}

const passThrough = (req, res, next) => next();

// No suite reaches the network: Soliomap's feed answers what the suite hands it, nothing by default.
const NO_FEED = Object.freeze({ activities: async () => null });

/**
 * The core's order commit, for a suite on its own database: where an order is collected (rule 67) is the core's reading
 * of the stay, which this database does not hold. `collection` is moved by the test; the order suites hand the real one.
 */
function fakeCommit(collection = 'departure') {
  const commit = { collection, orderCollection: () => commit.collection };
  return commit;
}

/** The plugin's real routers on an in-memory database, with a clock the test moves. */
async function startApi(db, {
  soliomapUrl = 'https://soliomap.example.test', limiters = {}, soliomapFeed = NO_FEED, uploadsDir = null, guestHost = null, commit = fakeCommit(), ...more
} = {}) {
  const clock = { now: paris('2099-07-07', '12:00') };
  const api = buildGuestApi({
    ...more,
    commit,
    db: () => db,
    soliomapUrl: () => soliomapUrl,
    soliomapFeed,
    appName: () => 'Domaine Solio',
    guestHost: () => guestHost,
    uploadsDir: () => uploadsDir,
    now: () => clock.now,
    translator: (lang) => forLang(lang, translationsModel.create(db)),
    limiters: {
      session: passThrough, lookup: passThrough, read: passThrough, order: passThrough, cardOrder: passThrough, status: passThrough, ...limiters,
    },
  });
  const app = express();
  app.use(express.json());
  // The operator's session, when a suite plays a role: `staff.user = { roles: ['reception'] }` before the call.
  const staff = { user: null };
  app.use((req, res, next) => { if (staff.user) req.user = staff.user; next(); });
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

  return { app, api, base, call, clock, commit, cookies, staff, close: () => new Promise((resolve) => { server.close(resolve); }) };
}

/** A lodging in the app, its code read straight from the table. */
function enable(api, db, propertyId = 1, patch = {}) {
  const models = require('../models/lodgingsModel')(db);
  models.save(propertyId, { enabled: true, ...patch });
  return db.prepare('SELECT lodgingCode FROM guest_app_lodgings WHERE propertyId = ?').get(propertyId).lodgingCode;
}

/** The stay's live link (rule 1), created like the SAS or the fiche would: the token the guest opens. */
function stayToken(db, reservationId) {
  return require('../models/stayLinksModel')(db).ensure(reservationId, new Date('2099-01-01T00:00:00Z')).token;
}

/** A stay session on the reservation, opened from its link as a guest would. */
async function openStay(call, db, reservationId) {
  return call('POST', '/public/v1/guest/sessions', { stayToken: stayToken(db, reservationId) });
}

/** The link of the lodging's latest reservation: the stay a suite wrote before opening its session. */
function latestStayToken(db, propertyId = 1) {
  const row = db.prepare("SELECT MAX(id) AS id FROM reservations WHERE propertyId = ? AND kind = 'reservation'").get(propertyId);
  return stayToken(db, row.id);
}

/** An option of the catalogue, linked to the given lodgings, with a per-lodging price where one is given. */
function addOption(db, { id, title, priceType = 'per_stay', price = 10, category = '', lodgings = [1, 2], prices = {}, freeUnits = {}, ...over }) {
  const row = { archivedAt: null, autoOptionType: null, isCancellationInsurance: 0, displayToClient: 1, ...over };
  db.prepare(`INSERT INTO options (id, title, priceType, price, category, archivedAt, autoOptionType, isCancellationInsurance, displayToClient)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, title, priceType, price, category, row.archivedAt, row.autoOptionType, row.isCancellationInsurance, row.displayToClient);
  lodgings.forEach((propertyId) => db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(propertyId, id));
  [...new Set([...Object.keys(prices), ...Object.keys(freeUnits)])].forEach((propertyId) => {
    db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (?, ?, ?, ?)')
      .run(Number(propertyId), id, prices[propertyId] ?? price, freeUnits[propertyId] ?? 0);
  });
  return id;
}

/** A resource linked to the given lodgings, with its per-lodging price and free minutes where given. */
function addResource(db, { id, name, priceType = 'per_hour', price = 30, lodgings = [1, 2], prices = {}, freeMinutes = {} }) {
  db.prepare('INSERT INTO resources (id, name, priceType, price, quantity) VALUES (?, ?, ?, ?, 1)').run(id, name, priceType, price);
  lodgings.forEach((propertyId) => db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (?, ?)').run(id, propertyId));
  [...new Set([...Object.keys(prices), ...Object.keys(freeMinutes)])].forEach((propertyId) => {
    db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (?, ?, ?, ?)')
      .run(Number(propertyId), id, prices[propertyId] ?? null, freeMinutes[propertyId] ?? 0);
  });
  return id;
}

/** The sell switch on, with the plugin fields given. */
function sell(db, kind, itemId, fields = {}) {
  const row = { sold: 1, shortDescriptionFr: null, shortDescriptionEn: null, maxQuantity: 10, needsStaff: 0, sortOrder: null, mediaId: null, ...fields };
  db.prepare(`INSERT OR REPLACE INTO guest_app_items (kind, itemId, sold, shortDescriptionFr, shortDescriptionEn, maxQuantity, needsStaff, sortOrder, mediaId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(kind, itemId, row.sold, row.shortDescriptionFr, row.shortDescriptionEn, row.maxQuantity, row.needsStaff, row.sortOrder, row.mediaId);
}

/** Service hours every day on the given ranges (shared, or one lodging's own), written as the PUT stores them. */
function openService(db, ranges = [['08:00', '20:00']], propertyId = null) {
  const add = db.prepare('INSERT INTO guest_app_service_hours (weekday, fromTime, toTime, propertyId) VALUES (?, ?, ?, ?)');
  [0, 1, 2, 3, 4, 5, 6].forEach((weekday) => ranges.forEach(([from, to]) => add.run(weekday, from, to, propertyId)));
}

/**
 * The plugins the shop reads through the registry: something pricing and scheduling the hours
 * (`hourly-resources`) and a payment provider (`online-payment`). `null` leaves the plugin out; `scheduler`
 * replaces the stub scheduler (one that knows no resource).
 */
function livePlugins({ hourly = true, payment = null, scheduler = null } = {}) {
  const registry = require('../../sdk/registry');
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  if (hourly) {
    const record = registry.ensure('hourly-resources');
    record.priceLineContributor = { id: 'hourly-resources', priceTypes: ['per_hour'], priceLine: () => null };
    record.resourceScheduler = scheduler || { slotsForStay: () => null, validateSessions: () => null };
  }
  if (payment) registry.ensure('online-payment').paymentProvider = { id: 'qonto', label: 'Qonto', isReady: () => payment === 'ready' };
  return () => registry.reset();
}

module.exports = {
  addOption, addResource, addStay, enable, fakeCommit, freshDb, livePlugins, openService, latestStayToken, openStay, paris, sell, startApi, stayToken,
};
