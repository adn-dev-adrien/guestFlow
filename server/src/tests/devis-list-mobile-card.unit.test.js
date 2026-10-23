// specs/devis-list-mobile-card.md rule 5 — nights, stay label and total TTC shaped by the server.
const test = require('node:test');
const assert = require('node:assert/strict');

const { stayNights, stayLabel } = require('../utils/stayRangeLabel');

test('stayNights counts nights between two ISO dates, across a DST change', () => {
  assert.equal(stayNights('2027-05-10', '2027-05-13'), 3);
  assert.equal(stayNights('2027-03-26', '2027-03-29'), 3);
  assert.equal(stayNights('2026-12-31', '2027-01-01'), 1);
});

test('stayNights is null when a date is missing or malformed', () => {
  assert.equal(stayNights('', '2027-05-13'), null);
  assert.equal(stayNights('2027-05-10', null), null);
  assert.equal(stayNights('10/05/2027', '13/05/2027'), null);
});

test('stayLabel prints the month and year once when the stay stays in one month', () => {
  assert.equal(stayLabel('2027-05-10', '2027-05-13'), '10 → 13 mai 2027 · 3 nuits');
});

test('stayLabel prints both months when the stay straddles two months of one year', () => {
  assert.equal(stayLabel('2027-07-28', '2027-08-02'), '28 juil. → 2 août 2027 · 5 nuits');
});

test('stayLabel prints both years when the stay straddles New Year', () => {
  assert.equal(stayLabel('2026-12-30', '2027-01-02'), '30 déc. 2026 → 2 janv. 2027 · 3 nuits');
});

test('stayLabel uses the singular for one night', () => {
  assert.equal(stayLabel('2027-03-31', '2027-04-01'), '31 mars → 1 avr. 2027 · 1 nuit');
});

test('stayLabel degrades to the date that exists, and to null when none does', () => {
  assert.equal(stayLabel('2027-05-10', ''), '10 mai 2027');
  assert.equal(stayLabel(null, '2027-05-13'), '13 mai 2027');
  assert.equal(stayLabel('', ''), null);
});

test('list rows carry nights, stayLabel and totalTtc (accommodation + tourist tax)', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY, kind TEXT, devisStatus TEXT, clientId INTEGER, propertyId INTEGER,
      startDate TEXT, endDate TEXT, finalPrice REAL, touristTaxTotal REAL, requestOrigin TEXT,
      attributionChannel TEXT, attributionLabel TEXT, attribution TEXT, createdAt TEXT
    );
    INSERT INTO properties VALUES (1, 'La Granja');
    INSERT INTO clients VALUES (1, 'Camille', 'Martin');
    INSERT INTO reservations (id, kind, devisStatus, clientId, propertyId, startDate, endDate, finalPrice, touristTaxTotal, createdAt)
      VALUES (1, 'devis', 'draft', 1, 1, '2027-05-10', '2027-05-13', 1200.1, 54.3, '2026-10-01');
  `);
  const { buildModel } = require('../models/devisModel');
  const rows = buildModel(db).list({});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nights, 3);
  assert.equal(rows[0].stayLabel, '10 → 13 mai 2027 · 3 nuits');
  assert.equal(rows[0].totalTtc, 1254.4);
});
