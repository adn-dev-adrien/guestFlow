// specs/payment-schedule-and-cancellation.md rule 52, reading of 2026-11-10 (audit R36-DB-M2) — a settled mid-stay note is
// money: a stay whose only money is such a note (a platform stay whose payout is ticked later) is refused deletion, its
// client and logement alike, an approved iCal cancellation keeps it as cancelled, and it holds its nights like any paid stay.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');
const clientsModel = require('../models/clientsModel');
const propertiesModel = require('../models/propertiesModel');
const icalCancellationModel = require('../models/icalCancellationModel');
const { carriesMoney: deletionCarriesMoney, MONEY_MESSAGE, CLIENT_MONEY_MESSAGE, PROPERTY_MONEY_MESSAGE } = require('../utils/deletionGuard');
const { carriesMoney, holdsDates } = require('../utils/stayMoney');
const { FAR_YEAR: Y } = require('./farYearFixture');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const NOTE = JSON.stringify([{ id: 1, total: 13, paidDate: `${Y}-03-02`, lines: [{ key: 'option:18', label: 'Bois', amount: 13 }] }]);

function seed({ platform = 'Booking.com', notes = NOTE } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  // Added at boot by database.js, not in schema.sql.
  db.exec('ALTER TABLE reservations ADD COLUMN midStaySettledNotes TEXT DEFAULT NULL');
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite fictif')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Ana', 'Lune')").run();
  const stay = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, sourceType, midStaySettledNotes)
    VALUES ('reservation', 1, 1, '${Y}-03-01', '${Y}-03-04', ?, 'ical', ?)`).run(platform, notes).lastInsertRowid);
  return { db, stay };
}

const count = (db) => db.prepare('SELECT COUNT(*) c FROM reservations').get().c;

test('R36-DB-M2 — a stay whose only money is a settled note is refused deletion, nothing deleted', () => {
  const { db, stay } = seed();
  const model = reservationsModel.create(db);
  assert.equal(model.deletionBlocker(stay), MONEY_MESSAGE);
  assert.deepEqual(model.removeGuarded(stay), { blocker: MONEY_MESSAGE });
  assert.equal(count(db), 1);
});

test('R36-DB-M2 — its client and its logement are refused deletion with it', () => {
  const { db } = seed();
  assert.equal(clientsModel.create(db).deletionBlocker(1), CLIENT_MONEY_MESSAGE);
  assert.equal(propertiesModel.buildModel(db).deletionBlocker(1), PROPERTY_MONEY_MESSAGE);
});

test('R36-DB-M2 — an approved iCal cancellation keeps it as cancelled, its note with it', () => {
  const { db, stay } = seed();
  db.prepare("INSERT INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel) VALUES (1, 1, 'Booking', 'http://x.test/b.ics', 'booking', 'Booking')").run();
  db.prepare('UPDATE reservations SET icalSyncLocked = 0, sourceIcalSourceId = 1 WHERE id = ?').run(stay);
  const alert = Number(db.prepare("INSERT INTO ical_cancellation_alerts (reservationId, sourceId, eventUid) VALUES (?, 1, 'E1')").run(stay).lastInsertRowid);
  const result = icalCancellationModel.buildModel(db).approve(alert);
  assert.equal(result.outcome, 'approved_kept');
  const row = db.prepare('SELECT kind, midStaySettledNotes FROM reservations WHERE id = ?').get(stay);
  assert.equal(row.kind, 'cancelled');
  assert.equal(row.midStaySettledNotes, NOTE);
});

test('R36-DB-M2 — the stay readings agree: money carried, nights held for a direct stay too', () => {
  const { db, stay } = seed({ platform: 'Direct' });
  assert.equal(carriesMoney(db, stay), true);
  assert.equal(holdsDates(db, { id: stay, kind: 'reservation', platform: 'Direct' }), true);
});

test('R36-DB-M2 — no note, an empty list or blanks: no money, the delete goes as before', () => {
  for (const notes of [null, '', '[]', ' [] ']) {
    const { db, stay } = seed({ platform: 'Direct', notes });
    assert.equal(deletionCarriesMoney(db, [stay]), false, JSON.stringify(notes));
    assert.equal(carriesMoney(db, stay), false, JSON.stringify(notes));
    assert.deepEqual(reservationsModel.create(db).removeGuarded(stay), { ok: true });
  }
});
