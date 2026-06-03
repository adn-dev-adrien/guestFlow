const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const icalDateDriftModel = require('../models/icalDateDriftModel');

// Locks the contract of the iCal date-drift approval model (specs/ical-sync-override-locked-dates.md §3, §4, §5).

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, clientId INTEGER,
    startDate TEXT, endDate TEXT, adults INTEGER DEFAULT 0,
    singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER,
    totalPrice REAL, finalPrice REAL,
    sourceType TEXT, icalSyncLocked INTEGER, updatedAt TEXT
  );
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT);
  CREATE TABLE ical_date_drift_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    previousStartDate TEXT NOT NULL,
    previousEndDate TEXT NOT NULL,
    newStartDate TEXT NOT NULL,
    newEndDate TEXT NOT NULL,
    detectedAt TEXT NOT NULL DEFAULT (datetime('now')),
    acknowledgedAt TEXT,
    outcome TEXT
  );
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte du moulin')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare(`
    INSERT INTO reservations
      (id, propertyId, clientId, startDate, endDate, adults, singleBeds, doubleBeds, babyBeds,
       totalPrice, finalPrice, sourceType, icalSyncLocked)
    VALUES (10, 1, 1, '2026-07-10', '2026-07-13', 2, 1, 1, 0, 400, 400, 'ical', 1)
  `).run();
  const model = icalDateDriftModel.buildModel(db);
  return { db, model };
}

test('recordPending: inserts a new row when no pending row exists for the reservation', () => {
  const { db, model } = freshModel();
  const result = model.recordPending({
    reservationId: 10,
    previousStartDate: '2026-07-10', previousEndDate: '2026-07-13',
    newStartDate: '2026-07-15', newEndDate: '2026-07-18',
  });
  assert.ok(result.inserted);
  const rows = db.prepare('SELECT * FROM ical_date_drift_alerts').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reservationId, 10);
  assert.equal(rows[0].newStartDate, '2026-07-15');
  assert.equal(rows[0].acknowledgedAt, null);
});

test('recordPending: UPDATES the existing pending row with new dates (rule 3)', () => {
  const { db, model } = freshModel();
  model.recordPending({
    reservationId: 10,
    previousStartDate: '2026-07-10', previousEndDate: '2026-07-13',
    newStartDate: '2026-07-15', newEndDate: '2026-07-18',
  });
  const result = model.recordPending({
    reservationId: 10,
    previousStartDate: '2026-07-10', previousEndDate: '2026-07-13',
    newStartDate: '2026-07-20', newEndDate: '2026-07-22',
  });
  assert.ok(result.updated);
  const rows = db.prepare('SELECT * FROM ical_date_drift_alerts').all();
  assert.equal(rows.length, 1, 'exactly one pending row per reservation');
  assert.equal(rows[0].newStartDate, '2026-07-20');
  assert.equal(rows[0].newEndDate, '2026-07-22');
  // previousStart/End must NOT change on re-record (the user still currently sees the original dates).
  assert.equal(rows[0].previousStartDate, '2026-07-10');
  assert.equal(rows[0].previousEndDate, '2026-07-13');
});

test('recordPending: idempotent when the new proposal matches the existing pending one', () => {
  const { db, model } = freshModel();
  model.recordPending({
    reservationId: 10,
    previousStartDate: '2026-07-10', previousEndDate: '2026-07-13',
    newStartDate: '2026-07-15', newEndDate: '2026-07-18',
  });
  const result = model.recordPending({
    reservationId: 10,
    previousStartDate: '2026-07-10', previousEndDate: '2026-07-13',
    newStartDate: '2026-07-15', newEndDate: '2026-07-18',
  });
  assert.equal(result.updated, false);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_date_drift_alerts').get().c, 1);
});

test('listPending: returns joined client + property and excludes acknowledged rows', () => {
  const { db, model } = freshModel();
  model.recordPending({
    reservationId: 10,
    previousStartDate: '2026-07-10', previousEndDate: '2026-07-13',
    newStartDate: '2026-07-15', newEndDate: '2026-07-18',
  });
  // Second reservation, already acknowledged → must not appear.
  db.prepare(`
    INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, sourceType, icalSyncLocked)
    VALUES (11, 1, 1, '2026-08-01', '2026-08-05', 'ical', 1)
  `).run();
  db.prepare(`
    INSERT INTO ical_date_drift_alerts
      (reservationId, previousStartDate, previousEndDate, newStartDate, newEndDate, detectedAt, acknowledgedAt, outcome)
    VALUES (11, '2026-08-01', '2026-08-05', '2026-08-03', '2026-08-07', datetime('now'), datetime('now'), 'approved')
  `).run();

  const pending = model.listPending();
  assert.equal(pending.length, 1);
  assert.deepEqual({
    reservationId: pending[0].reservationId,
    clientName: pending[0].clientName,
    propertyName: pending[0].propertyName,
    reservationExists: pending[0].reservationExists,
  }, {
    reservationId: 10,
    clientName: 'Jean Dupont',
    propertyName: 'Gîte du moulin',
    reservationExists: true,
  });
});

test('listPending: surfaces deleted reservations with reservationExists=false', () => {
  const { db, model } = freshModel();
  model.recordPending({
    reservationId: 10,
    previousStartDate: '2026-07-10', previousEndDate: '2026-07-13',
    newStartDate: '2026-07-15', newEndDate: '2026-07-18',
  });
  db.prepare('DELETE FROM reservations WHERE id = 10').run();
  const pending = model.listPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].reservationExists, false);
  assert.equal(pending[0].clientName, '#10', 'fallback label when client cannot be joined');
});

test('approve: applies narrow override, flips outcome, writes history, preserves capacity/price', () => {
  const { db, model } = freshModel();
  const rec = model.recordPending({
    reservationId: 10,
    previousStartDate: '2026-07-10', previousEndDate: '2026-07-13',
    newStartDate: '2026-07-15', newEndDate: '2026-07-18',
  });
  const result = model.approve(rec.id);
  assert.deepEqual(result, { ok: true });
  const r = db.prepare('SELECT * FROM reservations WHERE id = 10').get();
  assert.equal(r.startDate, '2026-07-15');
  assert.equal(r.endDate, '2026-07-18');
  // Spec §3 rule 7 — the override never touches:
  assert.equal(r.adults, 2);
  assert.equal(r.singleBeds, 1);
  assert.equal(r.doubleBeds, 1);
  assert.equal(r.totalPrice, 400);
  assert.equal(r.finalPrice, 400);
  assert.equal(r.icalSyncLocked, 1, 'lock stays armed for future non-date drifts');
  // Drift row flipped:
  const drift = db.prepare('SELECT acknowledgedAt, outcome FROM ical_date_drift_alerts WHERE id = ?').get(rec.id);
  assert.ok(drift.acknowledgedAt);
  assert.equal(drift.outcome, 'approved');
  // Audit history:
  const history = db.prepare('SELECT eventType, changedFields FROM reservation_history WHERE reservationId = 10').all();
  assert.equal(history.length, 1);
  const fields = JSON.parse(history[0].changedFields);
  assert.ok(fields.find((c) => c.field === 'startDate' && c.from === '2026-07-10' && c.to === '2026-07-15'));
  assert.ok(fields.find((c) => c.field === 'endDate' && c.from === '2026-07-13' && c.to === '2026-07-18'));
});

test('approve: returns 409 when the drift was already acknowledged', () => {
  const { model } = freshModel();
  const rec = model.recordPending({
    reservationId: 10,
    previousStartDate: '2026-07-10', previousEndDate: '2026-07-13',
    newStartDate: '2026-07-15', newEndDate: '2026-07-18',
  });
  model.approve(rec.id);
  const second = model.approve(rec.id);
  assert.deepEqual(second, { error: 'DEJA_TRAITE', status: 409 });
});

test('approve: returns 410 when the reservation was deleted in the meantime', () => {
  const { db, model } = freshModel();
  const rec = model.recordPending({
    reservationId: 10,
    previousStartDate: '2026-07-10', previousEndDate: '2026-07-13',
    newStartDate: '2026-07-15', newEndDate: '2026-07-18',
  });
  db.prepare('DELETE FROM reservations WHERE id = 10').run();
  const result = model.approve(rec.id);
  assert.deepEqual(result, { error: 'RESERVATION_SUPPRIMEE', status: 410 });
});

test('approve: returns 404 on a missing id', () => {
  const { model } = freshModel();
  assert.deepEqual(model.approve(99999), { error: 'INTROUVABLE', status: 404 });
});

test('reject: flips outcome without touching the reservation', () => {
  const { db, model } = freshModel();
  const rec = model.recordPending({
    reservationId: 10,
    previousStartDate: '2026-07-10', previousEndDate: '2026-07-13',
    newStartDate: '2026-07-15', newEndDate: '2026-07-18',
  });
  const result = model.reject(rec.id);
  assert.deepEqual(result, { ok: true });
  const r = db.prepare('SELECT startDate, endDate FROM reservations WHERE id = 10').get();
  assert.equal(r.startDate, '2026-07-10', 'reservation untouched after reject');
  assert.equal(r.endDate, '2026-07-13');
  const drift = db.prepare('SELECT acknowledgedAt, outcome FROM ical_date_drift_alerts WHERE id = ?').get(rec.id);
  assert.equal(drift.outcome, 'rejected');
});

test('reject: returns 409 when the drift was already acknowledged', () => {
  const { model } = freshModel();
  const rec = model.recordPending({
    reservationId: 10,
    previousStartDate: '2026-07-10', previousEndDate: '2026-07-13',
    newStartDate: '2026-07-15', newEndDate: '2026-07-18',
  });
  model.reject(rec.id);
  assert.deepEqual(model.reject(rec.id), { error: 'DEJA_TRAITE', status: 409 });
});

test('reject: returns 404 on a missing id', () => {
  const { model } = freshModel();
  assert.deepEqual(model.reject(99999), { error: 'INTROUVABLE', status: 404 });
});
