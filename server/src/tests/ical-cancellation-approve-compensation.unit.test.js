const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const icalCancellationModel = require('../models/icalCancellationModel');

// Approving an iCal cancellation DELETES the reservation, so the compensation it may leave behind
// has to be built from a snapshot taken before the delete, in the same transaction
// (specs/cancellation-compensation.md §3.2 rules 9-11).

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
    startDate TEXT, endDate TEXT, sourceType TEXT, icalSyncLocked INTEGER,
    platform TEXT, finalPrice REAL
  );
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, eventType TEXT, changedFields TEXT);
  CREATE TABLE ical_cancellation_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL, sourceId INTEGER NOT NULL, eventUid TEXT NOT NULL,
    detectedAt TEXT NOT NULL DEFAULT (datetime('now')), acknowledgedAt TEXT, outcome TEXT
  );
  CREATE TABLE cancellation_compensations (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    cancellationAlertId INTEGER UNIQUE,
    reservationId       INTEGER,
    propertyId          INTEGER,
    propertyName        TEXT    NOT NULL DEFAULT '',
    platform            TEXT    NOT NULL DEFAULT '',
    clientFirstName     TEXT    NOT NULL DEFAULT '',
    clientLastName      TEXT    NOT NULL DEFAULT '',
    startDate           TEXT,
    endDate             TEXT,
    cancelledStayAmount REAL,
    expectedAmount      REAL    NOT NULL DEFAULT 0,
    expectedDate        TEXT,
    receivedAmount      REAL,
    receivedDate        TEXT,
    status              TEXT    NOT NULL DEFAULT 'pending',
    notes               TEXT    NOT NULL DEFAULT '',
    createdAt           TEXT    NOT NULL DEFAULT (datetime('now')),
    updatedAt           TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`;

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Le Lodge')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Claire', 'Notin')").run();
  db.prepare("INSERT INTO ical_sources (id, name) VALUES (1, 'Airbnb')").run();
  db.prepare(`
    INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, sourceType, icalSyncLocked, platform, finalPrice)
    VALUES (10, 1, 1, '2026-09-04', '2026-09-07', 'ical', 0, 'Airbnb', 612.5)
  `).run();
  db.prepare(`
    INSERT INTO ical_import_events (sourceId, eventUid, reservationId, eventHash, startDate, endDate, summaryNormalized)
    VALUES (1, 'E1', 10, 'h', '2026-09-04', '2026-09-07', 'claire notin')
  `).run();
  return { db, model: icalCancellationModel.buildModel(db) };
}

const compensationRows = (db) => db.prepare('SELECT * FROM cancellation_compensations').all();

test('approve without a compensation: unchanged behaviour, nothing recorded', () => {
  const { db, model } = freshModel();
  const alert = model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  const result = model.approve(alert.id);
  assert.equal(result.outcome, 'approved');
  assert.equal(result.compensationId, null);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations WHERE id = 10').get().c, 0);
  assert.deepEqual(compensationRows(db), []);
});

test('approve with a compensation: snapshots the reservation before deleting it', () => {
  const { db, model } = freshModel();
  const alert = model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  const result = model.approve(alert.id, { expectedAmount: 84, expectedDate: '2026-08-26', notes: 'Hors délai' });

  assert.equal(result.outcome, 'approved');
  assert.ok(result.compensationId);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations WHERE id = 10').get().c, 0, 'reservation still deleted');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_import_events WHERE reservationId = 10').get().c, 0);

  const rows = compensationRows(db);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    {
      alertId: rows[0].cancellationAlertId,
      reservationId: rows[0].reservationId,
      propertyId: rows[0].propertyId,
      propertyName: rows[0].propertyName,
      platform: rows[0].platform,
      client: `${rows[0].clientFirstName} ${rows[0].clientLastName}`,
      startDate: rows[0].startDate,
      endDate: rows[0].endDate,
      stayAmount: rows[0].cancelledStayAmount,
      expectedAmount: rows[0].expectedAmount,
      expectedDate: rows[0].expectedDate,
      notes: rows[0].notes,
      status: rows[0].status,
    },
    {
      alertId: alert.id,
      reservationId: 10,
      propertyId: 1,
      propertyName: 'Le Lodge',
      platform: 'Airbnb',
      client: 'Claire Notin',
      startDate: '2026-09-04',
      endDate: '2026-09-07',
      stayAmount: 612.5,
      expectedAmount: 84,
      expectedDate: '2026-08-26',
      notes: 'Hors délai',
      status: 'pending',
    },
  );
});

test('approve with a compensation: the history audit entry is still written', () => {
  const { db, model } = freshModel();
  const alert = model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  model.approve(alert.id, { expectedAmount: 84, expectedDate: null, notes: '' });
  const history = db.prepare('SELECT eventType FROM reservation_history WHERE reservationId = 10').all();
  assert.equal(history.length, 1);
  assert.equal(history[0].eventType, 'delete');
});

test('approve: a failing compensation insert rolls the whole approval back', () => {
  const { db, model } = freshModel();
  // A row already claims this alert id → the UNIQUE constraint fires inside the transaction.
  const alert = model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  db.prepare('INSERT INTO cancellation_compensations (cancellationAlertId, expectedAmount) VALUES (?, 0)').run(alert.id);

  assert.throws(() => model.approve(alert.id, { expectedAmount: 84, expectedDate: null, notes: '' }));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations WHERE id = 10').get().c, 1, 'reservation survives');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ical_import_events WHERE reservationId = 10').get().c, 1, 'mapping survives');
  const stillPending = db.prepare('SELECT acknowledgedAt FROM ical_cancellation_alerts WHERE id = ?').get(alert.id);
  assert.equal(stillPending.acknowledgedAt, null, 'alert stays pending');
});

test('approve: an already-acknowledged alert is a 409 and records no compensation', () => {
  const { db, model } = freshModel();
  const alert = model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  model.approve(alert.id);
  assert.deepEqual(
    model.approve(alert.id, { expectedAmount: 84, expectedDate: null, notes: '' }),
    { error: 'DEJA_TRAITE', status: 409 },
  );
  assert.deepEqual(compensationRows(db), []);
});

test('approve: reservation already gone → idempotent, no compensation (nothing left to snapshot)', () => {
  const { db, model } = freshModel();
  const alert = model.recordPending({ reservationId: 10, sourceId: 1, eventUid: 'E1' });
  db.prepare('DELETE FROM reservations WHERE id = 10').run();
  const result = model.approve(alert.id, { expectedAmount: 84, expectedDate: null, notes: '' });
  assert.equal(result.outcome, 'reservation_gone');
  assert.equal(result.compensationId, null);
  assert.deepEqual(compensationRows(db), []);
});
