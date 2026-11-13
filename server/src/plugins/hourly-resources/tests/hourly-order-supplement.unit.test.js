// specs/hourly-resource-quantity-and-sas-scheduling.md rule 38 (guest-app rules 81-83; pricing-components rule 90.3) — the evening supplement of an app order's sessions, computed by
// the scheduler (`orderSupplement`), written by the order as a line of the stay under the supplement's own words and tagged with its order (`orderRef`), and the arrival commit's
// recompute that subtracts what those lines already bill, per resource, never below 0: whether the SAS runs before or after the order, or is re-opened, the same evening is billed once.
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
const evening = (start, end) => ({ date: '2099-07-13', start, end });
const WORDS = 'Bain nordique — supplément soirée';

function stayWithOfferedEvening(db, id, sessions) {
  db.prepare(`INSERT INTO reservations (id, propertyId, startDate, endDate, checkInTime, checkOutTime) VALUES (${id}, 1, '2099-07-13', '2099-07-15', '16:00', '10:00')`).run();
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, priceType, offered, unitPrice, billedUnits, totalPrice, sessions)
              VALUES (?, 1, ?, 'per_hour', 1, 25, 0, 0, ?)`).run(id, sessions.length, JSON.stringify(sessions));
  if (!db.prepare('PRAGMA table_info(reservation_custom_options)').all().some((c) => c.name === 'orderRef')) db.exec('ALTER TABLE reservation_custom_options ADD COLUMN orderRef TEXT');
  return { id, propertyId: 1, startDate: '2099-07-13', endDate: '2099-07-15' };
}
const charge = (db, reservationId, description, amount, orderRef, offered = 0) => db.prepare(
  'INSERT INTO reservation_custom_options (reservationId, description, amount, offered, orderRef) VALUES (?, ?, ?, ?, ?)',
).run(reservationId, description, amount, offered, orderRef);

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

test('rule 38: the arrival recompute subtracts the evening charges the app orders already wrote (tagged with their order), never below 0', () => {
  const db = seed();
  const reservation = stayWithOfferedEvening(db, 500, [evening('20:00', '22:00')]);
  const model = schedulingModel.create(db);
  assert.deepEqual(model.storedSupplements(reservation).map((s) => s.amount), [20], 'nothing billed yet: the SAS owes 2 x 10');
  charge(db, 500, WORDS, 10, 'order:7:1');
  assert.deepEqual(model.storedSupplements(reservation).map((s) => s.amount), [10], 'the order billed one evening hour: the SAS owes the other');
  charge(db, 500, WORDS, 30, 'order:8:1');
  assert.deepEqual(model.storedSupplements(reservation), [], 'never below 0');
  charge(db, 500, 'Sauna — supplément soirée', 9, 'order:9:1');
  assert.deepEqual(model.storedSupplements(reservation), [], 'another resource\'s charge is not subtracted here');
});

test('rule 38: only a line an order wrote counts — a charge with no order tag is the operator\'s own and the SAS still owes the evening', () => {
  const db = seed();
  const reservation = stayWithOfferedEvening(db, 502, [evening('20:00', '21:00')]);
  charge(db, 502, WORDS, 10, null);
  assert.deepEqual(schedulingModel.create(db).storedSupplements(reservation).map((s) => s.amount), [10]);
});

test('rule 38: an evening charge the operator offered still covers its evening — the SAS never bills it again', () => {
  const db = seed();
  const reservation = stayWithOfferedEvening(db, 501, [evening('20:00', '21:00')]);
  charge(db, 501, WORDS, 10, 'order:7:1', 1);
  assert.deepEqual(schedulingModel.create(db).storedSupplements(reservation), [], 'offered at the recap: the evening is covered, not billed a second time');
});
