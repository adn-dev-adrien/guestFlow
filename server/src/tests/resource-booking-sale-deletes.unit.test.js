// specs/resource-booking-pricing-and-invoicing.md rule 34 (R35-DB-M1, R35-DB-M2) — a resource booking sold outside a
// stay (plugin `hourly-resources`) whose payment is recorded, or that Qonto invoiced, is a sale of the journal: no delete
// of its resource (cascade), its client or its property (SET NULL) takes it, forced or not; a client booked on a
// resource is never an orphan of the cleanup.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const clientsModel = require('../models/clientsModel');
const propertiesModel = require('../models/propertiesModel');
const resourcesModel = require('../models/resourcesModel');
const { buildController: buildResourcesController } = require('../controllers/resourcesController');
const { BOOKING_MONEY_MESSAGES } = require('../utils/deletionGuard');
const hourly = optionalPlugin(() => require('../plugins/hourly-resources/migrations'));
const needs = { skip: skipWithout(['hourly-resources']) };
const { FAR_YEAR: Y } = require('./farYearFixture');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.pragma('foreign_keys = ON');
  hourly.createTables(db);
  hourly.bookingsV2(db);
  hourly.bookingsV3(db, () => 20);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite fictif')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Ana', 'Lune'), (2, 'Noé', 'Vent')").run();
  const resourceId = Number(db.prepare("INSERT INTO resources (name, priceType, price) VALUES ('Sauna fictif', 'per_stay', 50)").run().lastInsertRowid);
  const booking = (extra = {}) => Number(db.prepare(`INSERT INTO resource_bookings (resourceId, clientId, propertyId, date, startTime, endTime, totalPrice, paid, paidAt, paymentRecordedAt, qontoInvoiceId, invoiceCancelledAt)
    VALUES (@resourceId, @clientId, @propertyId, @date, @start, '19:00', 50, @paid, @paidAt, @paidAt, @invoice, @cancelled)`).run({
    resourceId, clientId: 1, propertyId: 1, date: `${Y}-02-13`, start: '18:00', paid: 0, paidAt: null, invoice: null, cancelled: null, ...extra,
  }).lastInsertRowid);
  return { db, resourceId, booking };
}

const fakeRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const count = (db, table) => db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;

test('rule 34 — a forced resource delete is refused while a booking of it is paid, or invoiced', needs, () => {
  for (const extra of [{ paid: 1, paidAt: `${Y}-02-13` }, { invoice: 'inv-1' }]) {
    const { db, resourceId, booking } = seed();
    booking(extra);
    const controller = buildResourcesController(resourcesModel.create(db));
    const res = fakeRes();
    controller.remove({ params: { id: String(resourceId) }, query: { force: 'true' } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'RESOURCE_CARRIES_MONEY');
    assert.equal(res.body.error, BOOKING_MONEY_MESSAGES.resourceId);
    assert.equal(count(db, 'resource_bookings'), 1);
    assert.equal(count(db, 'resources'), 1);
  }
});

test('rule 34 — unpaid bookings, or an invoice cancelled in Qonto, still go with a forced resource delete', needs, () => {
  const { db, resourceId, booking } = seed();
  booking();
  booking({ start: '17:00', invoice: 'inv-x', cancelled: `${Y}-02-14` });
  const controller = buildResourcesController(resourcesModel.create(db));
  const res = fakeRes();
  controller.remove({ params: { id: String(resourceId) }, query: { force: 'true' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(count(db, 'resource_bookings'), 0);
});

test('rule 34 — a client with a paid booking is refused deletion; a property alike', needs, () => {
  const { db, booking } = seed();
  booking({ paid: 1, paidAt: `${Y}-02-13` });
  assert.equal(clientsModel.create(db).getDeleteImpact(1).blocker, BOOKING_MONEY_MESSAGES.clientId);
  assert.equal(propertiesModel.buildModel(db).deletionBlocker(1), BOOKING_MONEY_MESSAGES.propertyId);
});

test('rule 34 — a client booked on a resource is no orphan: the cleanup keeps him and his booking keeps its name', needs, () => {
  const { db, booking } = seed();
  const id = booking({ paid: 1, paidAt: `${Y}-02-13`, invoice: 'inv-1' });
  const model = clientsModel.create(db);
  assert.deepEqual(model.listOrphans().map((c) => c.id), [2]);
  assert.deepEqual(model.cleanupOrphansByIds([1, 2]), { deletedCount: 1, skippedCount: 1 });
  assert.equal(model.cleanupOrphans().deletedCount, 0);
  assert.equal(db.prepare('SELECT clientId FROM resource_bookings WHERE id = ?').get(id).clientId, 1);
});
