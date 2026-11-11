// specs/reservation-number-and-search.md §4 — the recap migration writes only the templates it changes,
// so the « last modified » of an operator-edited reminder is not rewritten at every boot (audit 2026-10-28).
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { addReservationNumberToRecaps } = require('../utils/reservationNumberRecapMigration');

function templates() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE email_templates (id INTEGER PRIMARY KEY, stableKey TEXT, body TEXT, updatedAt TEXT)');
  const insert = db.prepare('INSERT INTO email_templates (stableKey, body, updatedAt) VALUES (?, ?, ?)');
  insert.run('arrival_reminder_7d', 'Rappel des informations de votre séjour :\n- Logement : {{propertyName}}\n- Arrivée', '2020-01-01 00:00:00');
  insert.run('arrival_reminder_1d', 'Texte réécrit par Solio, sans récapitulatif.', '2020-01-01 00:00:00');
  return db;
}

test('the recap that matches gets the number line and a new updatedAt', () => {
  const db = templates();
  addReservationNumberToRecaps(db);
  const row = db.prepare("SELECT body, updatedAt FROM email_templates WHERE stableKey = 'arrival_reminder_7d'").get();
  assert.match(row.body, /\{\{#if hasReservationNumber\}\}- N° de réservation : \{\{reservationNumber\}\}/);
  assert.notEqual(row.updatedAt, '2020-01-01 00:00:00');
});

test('a rewritten reminder with no anchor is not touched, updatedAt included', () => {
  const db = templates();
  addReservationNumberToRecaps(db);
  const row = db.prepare("SELECT body, updatedAt FROM email_templates WHERE stableKey = 'arrival_reminder_1d'").get();
  assert.equal(row.updatedAt, '2020-01-01 00:00:00');
  assert.equal(row.body, 'Texte réécrit par Solio, sans récapitulatif.');
});

test('a second run writes nothing', () => {
  const db = templates();
  addReservationNumberToRecaps(db);
  const changes = db.total_changes;
  addReservationNumberToRecaps(db);
  assert.equal(db.total_changes, changes);
});
