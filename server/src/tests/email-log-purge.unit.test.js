// emailLogModel.purgeRealizedStays — rolling-window cleanup.
// See specs/email-history-rolling-window.md §3 rule 3.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/emailLogModel');

const DDL = `
  CREATE TABLE email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    templateId INTEGER, reservationId INTEGER NOT NULL,
    sentAt TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'smtp', errorMessage TEXT DEFAULT '',
    renderedSubject TEXT NOT NULL, renderedBody TEXT NOT NULL, recipientEmail TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT
  );
`;

function fresh() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return { db, model: buildModel(db) };
}

function addReservation(db, id, startDate) {
  db.prepare("INSERT INTO reservations (id, kind, startDate, endDate) VALUES (?, 'reservation', ?, ?)")
    .run(id, startDate, startDate);
}
function addLog(model, reservationId) {
  model.insert({ templateId: null, reservationId, status: 'sent', renderedSubject: 'S', renderedBody: 'B' });
}
const idsLeft = (db) => db.prepare('SELECT reservationId FROM email_log ORDER BY reservationId').all().map((r) => r.reservationId);

test('purgeRealizedStays: removes past-window + orphan rows, keeps in-window (incl. arrival+3)', () => {
  const { db, model } = fresh();
  addReservation(db, 300, '2026-06-25'); // future → keep
  addReservation(db, 301, '2026-06-15'); // arrival+3 == today (2026-06-18) → keep (boundary)
  addReservation(db, 302, '2026-06-14'); // arrival+4 < today → purge
  // 999 has no reservation → orphan → purge
  [300, 301, 302, 999].forEach((rid) => addLog(model, rid));

  const removed = model.purgeRealizedStays('2026-06-18');
  assert.equal(removed, 2, 'past-window (302) + orphan (999) removed');
  assert.deepEqual(idsLeft(db), [300, 301]);
});

test('purgeRealizedStays: idempotent — a second run removes nothing', () => {
  const { db, model } = fresh();
  addReservation(db, 302, '2026-06-14');
  addLog(model, 302);
  assert.equal(model.purgeRealizedStays('2026-06-18'), 1);
  assert.equal(model.purgeRealizedStays('2026-06-18'), 0);
});

test('purgeRealizedStays: keeps everything when all stays are current', () => {
  const { db, model } = fresh();
  addReservation(db, 300, '2026-07-01');
  addReservation(db, 301, '2026-06-20');
  addLog(model, 300);
  addLog(model, 301);
  assert.equal(model.purgeRealizedStays('2026-06-18'), 0);
  assert.deepEqual(idsLeft(db), [300, 301]);
});

test('purgeRealizedStays: multiple log rows for the same past reservation are all removed', () => {
  const { db, model } = fresh();
  addReservation(db, 302, '2026-06-10');
  addLog(model, 302);
  addLog(model, 302);
  addLog(model, 302);
  assert.equal(model.purgeRealizedStays('2026-06-18'), 3);
  assert.equal(idsLeft(db).length, 0);
});
