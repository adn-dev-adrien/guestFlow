// specs/arrival-departure-sas.md rule 29 (2026-10-27 spec review) — a linen element the arrival SAS
// bills keeps its count. « Taie d'oreiller » × 2 at 3,30 € was stored as one custom row worth 6,60 €
// with no quantity, so the planning card (and every other reader) showed « ×1 ».

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const db = require('../database');
const model = require('../models/reservationsModel');
const bookingLinesModel = require('../models/bookingLinesModel');
const { ensureCustomLineQuantity } = require('../utils/sasCustomLineQuantityMigration');

db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Gîte fictif', 6)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Alex', 'Exemple')").run();
const PILLOW = Number(db.prepare("INSERT INTO linen_priced_items (label, price, category) VALUES ('Taie d''oreiller', 3.3, 'bed')").run().lastInsertRowid);

let nextId = 100;
function stay() {
  const id = nextId++;
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, platform, adults, complementAmount)
    VALUES (?, 'reservation', 1, 1, '2027-07-10', '2027-07-12', 'direct', 2, 0)`).run(id);
  return id;
}
const commitPillows = (id, qty) => model.commitArrivalSas(id, {
  complementItems: model.resolveSasArrivalItems(id, { linenItems: [{ itemId: PILLOW, qty }] }),
});
const pillowLine = (id) => model.getByIdWithDetails(id).options.find((o) => o.isCustom && o.title === "Taie d'oreiller");

test('the SAS line keeps its quantity: ×2, 3,30 € each, 6,60 € in all', () => {
  const id = stay();
  assert.equal(commitPillows(id, 2), 6.6);
  const line = pillowLine(id);
  assert.equal(line.quantity, 2);
  assert.equal(line.billedUnits, 2);
  assert.equal(line.unitPrice, 3.3);
  assert.equal(line.totalPrice, 6.6);
});

test('a single element still reads ×1 at its own price', () => {
  const id = stay();
  commitPillows(id, 1);
  const line = pillowLine(id);
  assert.equal(line.billedUnits, 1);
  assert.equal(line.unitPrice, 3.3);
});

test('a fiche save (DELETE + INSERT of the custom lines) keeps the count of a SAS line', () => {
  const id = stay();
  commitPillows(id, 2);
  const lines = bookingLinesModel.buildModel(db);
  const before = model.getByIdWithDetails(id).options.filter((o) => o.isCustom);
  lines.replaceCustomOptions(id, before);
  const line = pillowLine(id);
  assert.equal(line.billedUnits, 2);
  assert.equal(line.totalPrice, 6.6);
  assert.equal(line.sasArrivalOrigin, 1);
});

test('the backfill sets the count of an existing SAS row from its priced item, once', () => {
  const mem = new Database(':memory:');
  mem.exec(`
    CREATE TABLE migrations (name TEXT PRIMARY KEY, ran_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE linen_priced_items (id INTEGER PRIMARY KEY, label TEXT, price REAL);
    CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY, reservationId INTEGER, description TEXT,
      amount REAL, sasArrivalOrigin INTEGER NOT NULL DEFAULT 0);
    INSERT INTO linen_priced_items (label, price) VALUES ('Taie d''oreiller', 3.3), ('Drap', 12);
    INSERT INTO reservation_custom_options (id, reservationId, description, amount, sasArrivalOrigin) VALUES
      (1, 1, 'Taie d''oreiller', 6.6, 1),
      (2, 1, 'Drap', 12, 1),
      (3, 1, 'Drap', 20, 1),
      (4, 1, 'Taie d''oreiller', 6.6, 0);
  `);
  assert.equal(ensureCustomLineQuantity(mem), 1);
  const qty = (rowId) => mem.prepare('SELECT quantity FROM reservation_custom_options WHERE id = ?').get(rowId).quantity;
  assert.equal(qty(1), 2);
  assert.equal(qty(2), 1);
  assert.equal(qty(3), 1, 'not a clean multiple: left alone');
  assert.equal(qty(4), 1, 'a line the SAS did not write: left alone');
  mem.prepare('UPDATE reservation_custom_options SET quantity = 1 WHERE id = 1').run();
  assert.equal(ensureCustomLineQuantity(mem), 0, 'one-shot');
});
