// specs/ical-sync-override-locked-dates.md rule 11 — approving a date drift moves the stay under the same
// guards as every other date change (audit 2026-10-28): the new nights are checked against the other
// stays and the closures (a clash is flagged and notified), a platform stay's payout deadline follows
// its new departure, and only a live reservation can be moved.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const icalDateDriftModel = require('../models/icalDateDriftModel');
const { buildController } = require('../controllers/dashboardController');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  const insert = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, sourceType, icalSyncLocked, balanceDueDate)
                             VALUES (?, 1, 1, ?, ?, ?, 'ical', 1, ?)`);
  const mine = Number(insert.run('reservation', '2027-11-20', '2027-11-22', 'Booking', '2027-11-27').lastInsertRowid);
  const other = Number(insert.run('reservation', '2027-11-13', '2027-11-15', 'Airbnb', '2027-11-20').lastInsertRowid);
  const model = icalDateDriftModel.buildModel(db);
  const drift = (newStart, newEnd, id = mine) => model.recordPending({
    reservationId: id, previousStartDate: '2027-11-20', previousEndDate: '2027-11-22', newStartDate: newStart, newEndDate: newEnd,
  });
  return { db, model, mine, other, drift };
}

const row = (db, id) => db.prepare('SELECT startDate, endDate, balanceDueDate, bookingConflictAt FROM reservations WHERE id = ?').get(id);

test('rule 11 — a drift onto nights another stay holds is applied but flagged, and reported for the notification', () => {
  const { db, model, mine, drift } = seed();
  const alert = drift('2027-11-13', '2027-11-15');
  const result = model.approve(alert.id);
  assert.deepEqual(result, { ok: true, reservationId: mine, conflict: true });
  assert.ok(row(db, mine).bookingConflictAt);
});

test('rule 11 — a drift onto free nights is applied without a flag', () => {
  const { db, model, mine, drift } = seed();
  const result = model.approve(drift('2027-12-01', '2027-12-03').id);
  assert.deepEqual(result, { ok: true, reservationId: mine });
  assert.equal(row(db, mine).bookingConflictAt, null);
});

test('rule 11 — a drift onto a closure is flagged too', () => {
  const { db, model, mine, drift } = seed();
  db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (1, 'Travaux', '2027-12-01', '2027-12-10')").run();
  assert.equal(model.approve(drift('2027-12-02', '2027-12-04').id).conflict, true);
});

test('rule 11 — the payout deadline of a platform stay follows the new departure', () => {
  const { db, model, mine, drift } = seed();
  model.approve(drift('2027-12-01', '2027-12-05').id);
  const days = require('../models/platformsModel').create(db).getPayoutDueDays('Booking');
  const expected = new Date(Date.UTC(2027, 11, 5 + days)).toISOString().slice(0, 10);
  assert.equal(row(db, mine).balanceDueDate, expected);
  assert.notEqual(row(db, mine).balanceDueDate, '2027-11-27');
});

test('rule 11 — a stay that is no longer a live reservation is not moved, the alert stays pending', () => {
  const { db, model, mine, drift } = seed();
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(mine);
  const alert = drift('2027-12-01', '2027-12-03');
  const result = model.approve(alert.id);
  assert.equal(result.status, 409);
  assert.equal(row(db, mine).startDate, '2027-11-20');
  assert.equal(db.prepare('SELECT acknowledgedAt FROM ical_date_drift_alerts WHERE id = ?').get(alert.id).acknowledgedAt, null);
});

test('rule 11 — the controller notifies the conflict after the response', async () => {
  const { model, mine, drift } = seed();
  const notified = [];
  const controller = buildController({ icalDateDriftModel: model, emitPluginEvent: () => {}, notifyBookingConflict: (id, opts) => { notified.push([id, opts]); } });
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.approveIcalDateDrift({ params: { id: String(drift('2027-11-13', '2027-11-15').id) } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(notified, [[mine, { origin: 'ical' }]]);
});
