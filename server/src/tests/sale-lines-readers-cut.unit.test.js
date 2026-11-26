// specs/pricing/pricing-components.md §3 rules 31, 61, 63, 67, 91 — owner reading of 2026-11-15 (« éviter de toucher les anciens séjours ou les
// séjours déjà réservés »): the sale-line readers serve the stays booked once 4.2.0 is installed. `reservations.readsSaleLines` is 0 on
// every row the migration finds and on any row written without it, 1 on a stay or a devis the application creates.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const db = require('../database');
const { runPricingSalesMigration } = require('../utils/pricingSalesMigration');
const { readsSaleLines, markReadsSaleLines, hasFlagColumn } = require('../utils/saleLinesReaders');
const reservationsModel = require('../models/reservationsModel');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

test('rule 91 (2026-11-15) — the migration adds the column at 0 on every stay already booked', () => {
  const old = new Database(':memory:');
  old.exec("CREATE TABLE migrations (name TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')))");
  old.exec('CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT)');
  old.exec("INSERT INTO reservations (id, kind) VALUES (1, 'reservation'), (2, 'devis')");
  assert.equal(hasFlagColumn(old), false);
  runPricingSalesMigration(old);
  assert.deepEqual(old.prepare('SELECT id, readsSaleLines FROM reservations ORDER BY id').all(), [{ id: 1, readsSaleLines: 0 }, { id: 2, readsSaleLines: 0 }]);
  // A row written by code that does not know the column (the previous release, a fixture) is an old stay too.
  old.exec("INSERT INTO reservations (id, kind) VALUES (3, 'reservation')");
  assert.equal(readsSaleLines(old.prepare('SELECT * FROM reservations WHERE id = 3').get()), false);
});

test('rule 91 (2026-11-15) — a stay the application books reads its sale lines; a hand-built schema is left as it is', () => {
  db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9771, 'Coupure', 6, 0)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9771, 'Alex', 'Coupure')").run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, minNights) VALUES (9771, 'Standard', 90, 1)").run();
  const start = addDaysToIsoDate(todayIso(), 30);
  const result = reservationsModel.insertReservation(
    { propertyId: 9771, clientId: 9771, startDate: start, endDate: addDaysToIsoDate(start, 2), adults: 2, platform: 'direct' },
    { totalPrice: 180, finalPrice: 180, touristTaxTotal: 0, depositAmount: 0, balanceAmount: 180 },
    { blocksPreviousNight: 0, blocksNextNight: 0 },
  );
  const id = Number((result && (result.lastInsertRowid || result.id)) || db.prepare('SELECT MAX(id) AS id FROM reservations WHERE propertyId = 9771').get().id);
  assert.equal(db.prepare('SELECT readsSaleLines FROM reservations WHERE id = ?').get(id).readsSaleLines, 1);
  const bare = new Database(':memory:');
  bare.exec('CREATE TABLE reservations (id INTEGER PRIMARY KEY)');
  assert.equal(markReadsSaleLines(bare, 1), false);
});
