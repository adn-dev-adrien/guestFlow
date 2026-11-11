// Shared fixtures of the direct-installments suites (specs/direct-installments.md §7): the production
// baseline schema on an in-memory database, one property, one client, and helpers to place a stay and a
// plan on it. Not a test file — the suites import it, so none of them re-runs another.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { migrateInstallmentsSchema } = require('../utils/installmentsMigration');
const { registerDirectChannelSql } = require('../utils/platformNameFormat');
const { buildModel: buildInstallmentsModel } = require('../models/installmentsModel');
const { buildModel: buildLinksModel } = require('../models/paymentLinksModel');
const { buildController } = require('../controllers/installmentsController');

const TODAY = '2026-10-27';
const ARRIVAL = '2027-06-14';

function createDb({ balanceDaysBefore = 30 } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  migrateInstallmentsSchema(db);
  // Columns the boot migrations add after the baseline, read by the alert and the books.
  db.exec('ALTER TABLE reservations ADD COLUMN reservationNumber TEXT');
  db.exec('ALTER TABLE app_settings ADD COLUMN fiscalYearEndMonth INTEGER NOT NULL DEFAULT 12');
  registerDirectChannelSql(db);
  db.prepare("INSERT INTO properties (id, name, balanceDaysBefore) VALUES (1, 'La Granja', ?)").run(balanceDaysBefore);
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Camille', 'Martin', 'camille@example.com')").run();
  return db;
}

function addStay(db, fields = {}) {
  const row = {
    kind: 'reservation', platform: 'direct', startDate: ARRIVAL, endDate: '2027-06-21',
    finalPrice: 1001.5, createdAt: '2026-10-01 10:00:00', ...fields,
  };
  const columns = Object.keys(row);
  const info = db.prepare(`INSERT INTO reservations (propertyId, clientId, ${columns.join(', ')}) VALUES (1, 1, ${columns.map(() => '?').join(', ')})`)
    .run(...columns.map((c) => row[c]));
  return Number(info.lastInsertRowid);
}

// The engine stand-in: the pre-arrival amount the plan is made for, and the buckets a save would store.
function fakeQuote(preArrivalAmount = 1001.5, extra = {}) {
  return { preArrivalAmount, depositAmount: 0, balanceAmount: preArrivalAmount, depositDueDate: null, balanceDueDate: '2027-05-15', ...extra };
}

function createHarness({ preArrival = 1001.5, stay = {}, balanceDaysBefore = 30, providerReady = true, today = TODAY } = {}) {
  const db = createDb({ balanceDaysBefore });
  const reservationId = addStay(db, stay);
  const state = { quote: fakeQuote(preArrival), deactivated: [], events: [], today, paidLinkIds: new Set() };
  const installmentsModel = buildInstallmentsModel(db);
  const paymentLinksModel = buildLinksModel(db);
  const controller = buildController({
    database: db,
    installmentsModel,
    paymentLinksModel,
    quoteOf: () => state.quote,
    providerReady: () => providerReady,
    deactivateLinks: async (links) => {
      if (state.deactivationFails) throw new Error('provider down');
      state.deactivated.push(...links);
      links.forEach((l) => paymentLinksModel.clearRemoteCancelPending(l.id));
    },
    assertLinkNotPaid: async (link) => { if (state.paidLinkIds.has(link.id)) throw { message: 'paid' }; },
    emit: (name, payload) => state.events.push([name, payload]),
    todayOf: () => state.today,
  });
  return { db, reservationId, state, installmentsModel, paymentLinksModel, controller };
}

// Drives an Express-style handler and returns { status, body }.
async function call(handler, { params = {}, body = {} } = {}) {
  let status = 200;
  let payload;
  const res = {
    status(code) { status = code; return this; },
    json(value) { payload = value; return this; },
  };
  await handler({ params, body, user: { role: 'admin' } }, res);
  return { status, body: payload };
}

module.exports = { TODAY, ARRIVAL, createDb, addStay, fakeQuote, createHarness, call };
