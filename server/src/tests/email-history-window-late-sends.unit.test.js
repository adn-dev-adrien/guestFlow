// specs/email-history-rolling-window.md rule 9 (2026-10-27 spec review): an e-mail written after the
// arrival — the J+1 of a long stay, a season e-mail — stays in the history (and is not purged) for the
// same 3 days as any other, counted from the day it was written.

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
    renderedSubject TEXT NOT NULL, renderedBody TEXT NOT NULL, recipientEmail TEXT NOT NULL DEFAULT '', occurrenceKey TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT
  );
  CREATE TABLE email_templates (id INTEGER PRIMARY KEY, name TEXT, stableKey TEXT);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
`;

function setup() {
  const db = new Database(':memory:');
  db.exec(DDL);
  const model = buildModel(db);
  // A 7-night stay: arrival 10/07, departure 17/07; its J+1 leaves on 18/07.
  db.prepare("INSERT INTO reservations (id, startDate, endDate) VALUES (1, '2027-07-10', '2027-07-17')").run();
  const add = (sentAt) => {
    const row = model.insert({ templateId: null, reservationId: 1, status: 'sent', renderedSubject: 'S', renderedBody: 'B' });
    db.prepare('UPDATE email_log SET sentAt = ? WHERE id = ?').run(sentAt, row.id);
    return row.id;
  };
  return { db, model, add };
}

test('a J+1 sent after a 7-night stay is in the history the day it leaves and for 3 days after', () => {
  const { model, add } = setup();
  const id = add('2027-07-18 06:00:00');
  for (const today of ['2027-07-18', '2027-07-21']) {
    assert.deepEqual(model.history({ today }).rows.map((r) => r.id), [id], today);
  }
  assert.equal(model.history({ today: '2027-07-22' }).total, 0);
});

test('the purge keeps the J+1 while it is current, then removes it; the J-7 still follows the arrival', () => {
  const { db, model, add } = setup();
  const j7 = add('2027-07-03 06:00:00');
  const j1 = add('2027-07-18 06:00:00');
  assert.equal(model.purgeRealizedStays('2027-07-18'), 1);
  assert.deepEqual(db.prepare('SELECT id FROM email_log').all().map((r) => r.id), [j1]);
  assert.ok(j7);
  assert.equal(model.purgeRealizedStays('2027-07-22'), 1);
});

test('a season e-mail written months after the stay is visible the day it is written', () => {
  const { model, add } = setup();
  const id = add('2027-11-15 07:00:00');
  assert.deepEqual(model.history({ today: '2027-11-15' }).rows.map((r) => r.id), [id]);
});
