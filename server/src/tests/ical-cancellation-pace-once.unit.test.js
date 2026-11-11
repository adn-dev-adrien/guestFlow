// specs/ical-cancellation-approval.md rule 16 (audit R2 E) — the booking-pace ledger row is written
// only when the stay is really deleted: a kept (cancelled) stay is already counted as a cancelled row.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const icalCancellationModel = require('../models/icalCancellationModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed({ paid }) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec(`CREATE TABLE IF NOT EXISTS booking_pace_cancellations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, propertyId INTEGER,
    startDate TEXT NOT NULL, endDate TEXT NOT NULL, totalSejour REAL NOT NULL DEFAULT 0,
    reservationCreatedAt TEXT, cancelledAt TEXT NOT NULL DEFAULT (datetime('now')), createdAt TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO ical_sources (id, propertyId, name, url, platformKey, platformLabel) VALUES (1, 1, 'Airbnb', 'http://x.test/a.ics', 'airbnb', 'Airbnb')").run();
  const stay = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, sourceType, sourceIcalSourceId, finalPrice, balancePaid)
    VALUES ('reservation', 1, 1, '2099-06-01', '2099-06-04', 'Airbnb', 'ical', 1, 300, ?)`).run(paid ? 1 : 0).lastInsertRowid);
  const alert = Number(db.prepare("INSERT INTO ical_cancellation_alerts (reservationId, sourceId, eventUid) VALUES (?, 1, 'E1')").run(stay).lastInsertRowid);
  return { db, stay, alert };
}
const ledger = (db) => db.prepare('SELECT COUNT(*) c FROM booking_pace_cancellations').get().c;

test('rule 16 — approving the cancellation of a stay that carries money writes no pace ledger row', () => {
  const { db, alert } = seed({ paid: true });
  const result = icalCancellationModel.buildModel(db).approve(alert);
  assert.equal(result.outcome, 'approved_kept');
  assert.equal(ledger(db), 0);
});

test('rule 16 — approving the cancellation of a stay with no money still writes its ledger row', () => {
  const { db, alert } = seed({ paid: false });
  const result = icalCancellationModel.buildModel(db).approve(alert);
  assert.equal(result.outcome, 'approved');
  assert.equal(ledger(db), 1);
});
