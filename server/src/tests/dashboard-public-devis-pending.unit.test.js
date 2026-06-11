const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');

/**
 * listPendingPublicDevis (specs/site-booking-notifications.md §3 rule 5) — the data source for the
 * dashboard DevisPublicRequestAlert. It must return ONLY site-origin devis still awaiting handling:
 * requestOrigin='public', kind='devis', devisStatus='draft', not converted.
 */

function seedDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT, devisNumber TEXT, devisStatus TEXT,
      convertedReservationId INTEGER, requestOrigin TEXT DEFAULT '', clientId INTEGER, propertyId INTEGER,
      startDate TEXT, endDate TEXT, finalPrice REAL, createdAt TEXT);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
  `);
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Marie', 'Durand')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Le Gîte')").run();
  const ins = db.prepare(`INSERT INTO reservations
    (id, kind, devisNumber, devisStatus, convertedReservationId, requestOrigin, clientId, propertyId, startDate, endDate, finalPrice, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, 1, 1, '2026-09-11', '2026-09-14', 300, ?)`);
  // A — should appear: public draft devis, not converted.
  ins.run(10, 'devis', 'D-10', 'draft', null, 'public', '2026-06-11 09:00:00');
  // B — excluded: public devis but already 'sent'.
  ins.run(11, 'devis', 'D-11', 'sent', null, 'public', '2026-06-11 08:00:00');
  // C — excluded: public draft devis but converted.
  ins.run(12, 'devis', 'D-12', 'draft', 999, 'public', '2026-06-11 07:00:00');
  // D — excluded: draft devis but NOT public origin.
  ins.run(13, 'devis', 'D-13', 'draft', null, '', '2026-06-11 06:00:00');
  // E — excluded: a confirmed reservation, even if marked public.
  ins.run(14, 'reservation', null, null, null, 'public', '2026-06-11 10:00:00');
  return db;
}

test('listPendingPublicDevis returns only public, draft, unconverted devis', () => {
  const model = reservationsModel.create(seedDb());
  const rows = model.listPendingPublicDevis();
  assert.equal(rows.length, 1, 'exactly one pending site devis');
  assert.equal(rows[0].id, 10);
  assert.equal(rows[0].devisNumber, 'D-10');
  assert.equal(rows[0].clientName, 'Marie Durand');
  assert.equal(rows[0].propertyName, 'Le Gîte');
  assert.equal(rows[0].finalPrice, 300);
});

test('empty when nothing pending', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT, devisNumber TEXT, devisStatus TEXT,
      convertedReservationId INTEGER, requestOrigin TEXT DEFAULT '', clientId INTEGER, propertyId INTEGER,
      startDate TEXT, endDate TEXT, finalPrice REAL, createdAt TEXT);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
  `);
  const model = reservationsModel.create(db);
  assert.deepEqual(model.listPendingPublicDevis(), []);
});
