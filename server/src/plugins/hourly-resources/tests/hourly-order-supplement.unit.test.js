// specs/hourly-resource-quantity-and-sas-scheduling.md rule 38 (guest-app rule 83) — the evening supplement of an order's
// sessions, computed by the scheduler (`orderSupplement`), and the arrival commit's recompute that does not bill it again.
const test = require('node:test');
const assert = require('node:assert/strict');

const { DDL } = require('./hourlySchedulingFixture');
const { createScheduler } = require('../scheduler');
const schedulingModel = require('../schedulingModel');

function seed() {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'La Granja')").run();
  db.prepare(`INSERT INTO resources (id, name, price, turnoverMinutes, minimumUsageMinutes, slotDuration, openTime, closeTime, hourlyEveningStart,
    hourlyEveningRate, heatUpMinutes, heatRetentionMinutes, quantity, openDays, closedDays, priceType, showsPlanningCard)
    VALUES (1, 'Bain nordique', 25, 0, 60, 60, '11:00', '22:00', '19:00', 35, 0, 0, 1, '[0,1,2,3,4,5,6]', '[]', 'per_hour', 1)`).run();
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price) VALUES (1, 1, 25)').run();
  return db;
}
const stay = { propertyId: 1 };
const evening = (start, end) => ({ date: '2099-07-13', start, end });

test('rule 38: the order supplement is the evening difference of the sessions minus what the line gain bills above the day rate', () => {
  const scheduler = createScheduler(seed());
  const sessions = [evening('20:00', '21:00')];
  assert.equal(scheduler.orderSupplement({ resourceId: 1, propertyId: 1, sessions, lineGain: { amount: 0, hours: 0 } }), 10, 'an offered or held hour in the evening');
  assert.equal(scheduler.orderSupplement({ resourceId: 1, propertyId: 1, sessions, lineGain: { amount: 35, hours: 1 } }), 0, 'the line already bills the evening rate');
  assert.equal(scheduler.orderSupplement({ resourceId: 1, propertyId: 1, sessions: [evening('17:00', '18:00')], lineGain: { amount: 0, hours: 0 } }), 0, 'a day hour owes nothing');
  assert.equal(scheduler.orderSupplement({ resourceId: 1, propertyId: 1, sessions: [evening('18:00', '20:00')], lineGain: { amount: 60, hours: 2 } }), 0, 'two hours billed 25 + 35: the line carries its evening hour');
  assert.equal(scheduler.orderSupplement({ resourceId: 1, propertyId: 1, sessions: [evening('18:00', '20:00')], lineGain: { amount: 50, hours: 2 } }), 10, 'two hours at the day rate: the evening hour is still owed');
  assert.equal(scheduler.orderSupplement({ resourceId: 404, propertyId: 1, sessions, lineGain: {} }), 0, 'not an hourly resource here');
});

test('rule 38: the arrival recompute subtracts the evening charges the guest-app orders already wrote, never below 0', () => {
  const db = seed();
  db.prepare("INSERT INTO reservations (id, propertyId, startDate, endDate, checkInTime, checkOutTime) VALUES (500, 1, '2099-07-13', '2099-07-15', '16:00', '10:00')").run();
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, priceType, offered, unitPrice, billedUnits, totalPrice, sessions)
              VALUES (500, 1, 2, 'per_hour', 1, 25, 0, 0, ?)`).run(JSON.stringify([evening('20:00', '22:00')]));
  const model = schedulingModel.create(db);
  const reservation = { id: 500, propertyId: 1, startDate: '2099-07-13', endDate: '2099-07-15' };
  assert.deepEqual(model.storedSupplements(reservation).map((s) => s.amount), [20], 'nothing billed yet: the SAS owes 2 x 10');
  db.exec('ALTER TABLE reservation_custom_options ADD COLUMN orderChargeKey TEXT');
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, orderChargeKey) VALUES (500, 'Bain nordique — supplément soirée', 10, 'guest-order:7:evening:1')").run();
  assert.deepEqual(model.storedSupplements(reservation).map((s) => s.amount), [10], 'the order billed one evening hour: the SAS owes the other');
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, orderChargeKey) VALUES (500, 'Bain nordique — supplément soirée', 30, 'guest-order:8:evening:1')").run();
  assert.deepEqual(model.storedSupplements(reservation), [], 'never below 0');
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, orderChargeKey) VALUES (500, 'autre', 9, 'guest-order:9:evening:2')").run();
  assert.deepEqual(model.storedSupplements(reservation), [], 'another resource\'s charge is not subtracted here');
});

test('rule 38 (audit item 13): an evening charge the operator offered still covers its evening — the SAS never bills it again', () => {
  const db = seed();
  db.prepare("INSERT INTO reservations (id, propertyId, startDate, endDate, checkInTime, checkOutTime) VALUES (501, 1, '2099-07-13', '2099-07-15', '16:00', '10:00')").run();
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, priceType, offered, unitPrice, billedUnits, totalPrice, sessions)
              VALUES (501, 1, 1, 'per_hour', 1, 25, 0, 0, ?)`).run(JSON.stringify([evening('20:00', '21:00')]));
  db.exec('ALTER TABLE reservation_custom_options ADD COLUMN orderChargeKey TEXT');
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, offered, orderChargeKey) VALUES (501, 'Bain nordique — supplément soirée', 10, 1, 'guest-order:7:evening:1')").run();
  const model = schedulingModel.create(db);
  assert.deepEqual(model.storedSupplements({ id: 501, propertyId: 1, startDate: '2099-07-13', endDate: '2099-07-15' }), [], 'offered at the recap: the evening is covered, not billed a second time');
});
