// specs/payment-schedule-and-cancellation.md rule 58 (audit R36-DB-L1, 2026-11-10) — a caution received and not
// returned is the only record of what a guest is owed back: the stay, its client and its logement are refused deletion
// while it is held, and an approved iCal cancellation keeps the stay as cancelled. A returned caution frees them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');
const clientsModel = require('../models/clientsModel');
const propertiesModel = require('../models/propertiesModel');
const icalCancellationModel = require('../models/icalCancellationModel');
const { CAUTION_MESSAGES } = require('../utils/deletionGuard');
const { FAR_YEAR: Y } = require('./farYearFixture');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed({ returned = 0 } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite fictif')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Ana', 'Lune')").run();
  const stay = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, sourceType,
      cautionAmount, cautionReceived, cautionReceivedDate, cautionReturned)
    VALUES ('reservation', 1, 1, '${Y}-03-01', '${Y}-03-04', 'Booking.com', 'ical', 500, 1, '${Y}-03-01', ?)`).run(returned).lastInsertRowid);
  return { db, stay };
}

test('R36-DB-L1 — a held caution refuses the stay delete, nothing deleted', () => {
  const { db, stay } = seed();
  const model = reservationsModel.create(db);
  assert.equal(model.deletionBlocker(stay), CAUTION_MESSAGES.reservation);
  assert.deepEqual(model.removeGuarded(stay), { blocker: CAUTION_MESSAGES.reservation });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations').get().c, 1);
});

test('R36-DB-L1 — and the delete of its client or its logement', () => {
  const { db } = seed();
  assert.equal(clientsModel.create(db).deletionBlocker(1), CAUTION_MESSAGES.client);
  assert.equal(propertiesModel.buildModel(db).deletionBlocker(1), CAUTION_MESSAGES.property);
});

test('R36-DB-L1 — an approved iCal cancellation keeps the stay as cancelled, the caution on it', () => {
  const { db, stay } = seed();
  db.prepare("INSERT INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel) VALUES (1, 1, 'Booking', 'http://x.test/b.ics', 'booking', 'Booking')").run();
  db.prepare('UPDATE reservations SET icalSyncLocked = 0, sourceIcalSourceId = 1 WHERE id = ?').run(stay);
  const alert = Number(db.prepare("INSERT INTO ical_cancellation_alerts (reservationId, sourceId, eventUid) VALUES (?, 1, 'E1')").run(stay).lastInsertRowid);
  assert.equal(icalCancellationModel.buildModel(db).approve(alert).outcome, 'approved_kept');
  assert.deepEqual({ ...db.prepare('SELECT kind, cautionReceived, cautionReturned FROM reservations WHERE id = ?').get(stay) },
    { kind: 'cancelled', cautionReceived: 1, cautionReturned: 0 });
});

test('R36-DB-L1 — a returned caution refuses nothing', () => {
  const { db, stay } = seed({ returned: 1 });
  assert.equal(reservationsModel.create(db).deletionBlocker(stay), null);
  assert.equal(clientsModel.create(db).deletionBlocker(1), null);
  assert.deepEqual(reservationsModel.create(db).removeGuarded(stay), { ok: true });
});
