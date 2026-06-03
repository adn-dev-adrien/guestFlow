const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const icalCancellationModel = require('../models/icalCancellationModel');

// Pins the contract of the iCal cancellation approval model
// (specs/ical-cancellation-approval.md §3, §4, §5).

const DDL = `
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT);
  CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE ical_import_events (
    sourceId INTEGER, eventUid TEXT, reservationId INTEGER, eventHash TEXT,
    startDate TEXT, endDate TEXT, summaryNormalized TEXT, lastSeenAt TEXT,
    UNIQUE(sourceId, eventUid)
  );
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, propertyId INTEGER, clientId INTEGER,
    startDate TEXT, endDate TEXT, sourceType TEXT, icalSyncLocked INTEGER
  );
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT);
  CREATE TABLE ical_cancellation_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    sourceId INTEGER NOT NULL,
    eventUid TEXT NOT NULL,
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
  db.prepare("INSERT INTO ical_sources (id, name) VALUES (1, 'Airbnb')").run();
  db.prepare(`
    INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, sourceType, icalSyncLocked)
    VALUES (10, 1, 1, '2026-07-10', '2026-07-13', 'ical', 0)
  `).run();
  db.prepare(`
    INSERT INTO ical_import_events (sourceId, eventUid, reservationId, eventHash, startDate, endDate, summaryNormalized)
    VALUES (1, 'E1', 10, 'h', '2026-07-10', '2026-07-13', 'jean dupont')
  `).run();
  const model = icalCancellationModel.buildModel(db);
  return { db, model };
}

test('recordPending: inserts a new row when no pending row exists for the reservation', () => {
  const { db, model } = freshModel();
  const result = model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  assert.ok(result.inserted);
  const rows = db.prepare('SELECT * FROM ical_cancellation_alerts').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reservationId, 10);
  assert.equal(rows[0].sourceId, 1);
  assert.equal(rows[0].eventUid, 'E1');
  assert.equal(rows[0].acknowledgedAt, null);
});

test('recordPending: UPDATES the existing pending row when another source drops the same reservation', () => {
  const { db, model } = freshModel();
  db.prepare("INSERT INTO ical_sources (id, name) VALUES (2, 'Booking')").run();
  model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  const r2 = model.recordPending({ reservationId: 10, sourceId: 2, eventUid: 'X42' });
  assert.ok(r2.updated);
  const rows = db.prepare('SELECT * FROM ical_cancellation_alerts').all();
  assert.equal(rows.length, 1, 'exactly one pending row per reservation');
  assert.equal(rows[0].sourceId, 2, 'latest source wins');
  assert.equal(rows[0].eventUid, 'X42');
});

test('listPending: joins client + property + source; excludes acknowledged rows', () => {
  const { db, model } = freshModel();
  model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  // Acknowledged row on another reservation — must not appear.
  db.prepare(`
    INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, sourceType, icalSyncLocked)
    VALUES (11, 1, 1, '2026-08-01', '2026-08-05', 'ical', 0)
  `).run();
  db.prepare(`
    INSERT INTO ical_cancellation_alerts (reservationId, sourceId, eventUid, detectedAt, acknowledgedAt, outcome)
    VALUES (11, 1, 'OLD', datetime('now'), datetime('now'), 'approved')
  `).run();

  const pending = model.listPending();
  assert.equal(pending.length, 1);
  assert.deepEqual({
    reservationId: pending[0].reservationId,
    clientName: pending[0].clientName,
    propertyName: pending[0].propertyName,
    sourceName: pending[0].sourceName,
    startDate: pending[0].startDate,
    endDate: pending[0].endDate,
    reservationExists: pending[0].reservationExists,
  }, {
    reservationId: 10,
    clientName: 'Jean Dupont',
    propertyName: 'Gîte du moulin',
    sourceName: 'Airbnb',
    startDate: '2026-07-10',
    endDate: '2026-07-13',
    reservationExists: true,
  });
});

test('listPending: surfaces deleted reservations with reservationExists=false', () => {
  const { db, model } = freshModel();
  model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  db.prepare('DELETE FROM reservations WHERE id = 10').run();
  const pending = model.listPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].reservationExists, false);
  assert.equal(pending[0].clientName, '#10', 'fallback label when client cannot be joined');
});

test('resolveOnReappearance: deletes pending rows matching (sourceId, eventUid)', () => {
  const { db, model } = freshModel();
  db.prepare(`
    INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, sourceType, icalSyncLocked)
    VALUES (20, 1, 1, '2026-08-01', '2026-08-05', 'ical', 0)
  `).run();
  model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  model.recordPending({ reservationId: 20, sourceId: 1, eventUid: 'E2' });

  const resolved = model.resolveOnReappearance([{ sourceId: 1, eventUid: 'E1' }]);
  assert.equal(resolved, 1);
  const remaining = db.prepare('SELECT reservationId, eventUid FROM ical_cancellation_alerts WHERE acknowledgedAt IS NULL').all();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].reservationId, 20);
});

test('resolveOnReappearance: empty input is a no-op', () => {
  const { model } = freshModel();
  assert.equal(model.resolveOnReappearance([]), 0);
  assert.equal(model.resolveOnReappearance(null), 0);
  assert.equal(model.resolveOnReappearance(undefined), 0);
});

test('resolveOnReappearance: does NOT touch acknowledged rows', () => {
  const { db, model } = freshModel();
  const rec = model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  model.reject(rec.id);
  // The row is acknowledged. Re-includes the UID in a feed → must NOT be re-deleted.
  const before = db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts WHERE acknowledgedAt IS NOT NULL').get().c;
  const resolved = model.resolveOnReappearance([{ sourceId: 1, eventUid: 'E1' }]);
  const after = db.prepare('SELECT COUNT(*) c FROM ical_cancellation_alerts WHERE acknowledgedAt IS NOT NULL').get().c;
  assert.equal(resolved, 0);
  assert.equal(after, before);
});

test('approve: deletes reservation + ical_import_events + history audit + flips outcome', () => {
  const { db, model } = freshModel();
  const rec = model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  const result = model.approve(rec.id);
  assert.deepEqual(result, { ok: true, outcome: 'approved' });

  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations WHERE id = 10').get().c, 0, 'reservation deleted');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_import_events WHERE reservationId = 10').get().c, 0, 'mappings cleared');
  const drift = db.prepare('SELECT acknowledgedAt, outcome FROM ical_cancellation_alerts WHERE id = ?').get(rec.id);
  assert.ok(drift.acknowledgedAt);
  assert.equal(drift.outcome, 'approved');
  const history = db.prepare("SELECT eventType, changedFields FROM reservation_history WHERE reservationId = 10").all();
  assert.equal(history.length, 1);
  assert.equal(history[0].eventType, 'delete');
});

test('approve: reservation already deleted → returns { ok, outcome: reservation_gone } (idempotent)', () => {
  const { db, model } = freshModel();
  const rec = model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  db.prepare('DELETE FROM reservations WHERE id = 10').run();
  const result = model.approve(rec.id);
  assert.deepEqual(result, { ok: true, outcome: 'reservation_gone' });
  const drift = db.prepare('SELECT outcome FROM ical_cancellation_alerts WHERE id = ?').get(rec.id);
  assert.equal(drift.outcome, 'reservation_gone');
});

test('approve: returns 409 when already acknowledged', () => {
  const { model } = freshModel();
  const rec = model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  model.approve(rec.id);
  assert.deepEqual(model.approve(rec.id), { error: 'DEJA_TRAITE', status: 409 });
});

test('approve: returns 404 on a missing id', () => {
  const { model } = freshModel();
  assert.deepEqual(model.approve(99999), { error: 'INTROUVABLE', status: 404 });
});

test('reject: flips outcome without touching the reservation', () => {
  const { db, model } = freshModel();
  const rec = model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  const result = model.reject(rec.id);
  assert.deepEqual(result, { ok: true });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations WHERE id = 10').get().c, 1, 'reservation kept');
  const drift = db.prepare('SELECT outcome FROM ical_cancellation_alerts WHERE id = ?').get(rec.id);
  assert.equal(drift.outcome, 'rejected');
});

test('reject: returns 409 when already acknowledged', () => {
  const { model } = freshModel();
  const rec = model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  model.reject(rec.id);
  assert.deepEqual(model.reject(rec.id), { error: 'DEJA_TRAITE', status: 409 });
});

test('reject: returns 404 on a missing id', () => {
  const { model } = freshModel();
  assert.deepEqual(model.reject(99999), { error: 'INTROUVABLE', status: 404 });
});
