const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');

// specs/reservation-option-immutability.md — an existing reservation is frozen against later
// changes to the `options` catalog. `reservation_options` snapshots the unit/total price, billed
// units, priceType and offered flag at creation; the read paths (getPricingSnapshot, the finance
// and accounting models) read those snapshot columns, never the live option price. So changing an
// option's price, archiving it, or flipping its offered/default config does NOT alter any
// already-created reservation's billed content.
//
// The ONLY accepted exception is cosmetic (rule 7, Q2 "gel données, libellé live"): the displayed
// option label joins the live `options` row, so renaming follows on existing reservations — with
// no amount change. Both facts are pinned below so the decision stays explicit.

const DDL = `
  CREATE TABLE options (
    id INTEGER PRIMARY KEY,
    title TEXT,
    description TEXT,
    price REAL NOT NULL DEFAULT 0,
    priceType TEXT NOT NULL DEFAULT 'per_stay',
    autoOptionType TEXT,
    archivedAt TEXT
  );
  CREATE TABLE reservation_options (
    reservationId INTEGER NOT NULL,
    optionId INTEGER NOT NULL,
    quantity REAL DEFAULT 1,
    unitPrice REAL NOT NULL DEFAULT 0,
    billedUnits REAL NOT NULL DEFAULT 0,
    priceType TEXT NOT NULL DEFAULT 'per_stay',
    totalPrice REAL DEFAULT 0,
    offered INTEGER NOT NULL DEFAULT 0,
    inComplement INTEGER NOT NULL DEFAULT 0,
    acompteContribTtc REAL DEFAULT NULL,
    soldeContribTtc REAL DEFAULT NULL,
    PRIMARY KEY (reservationId, optionId)
  );
  CREATE TABLE reservation_resources (
    reservationId INTEGER NOT NULL,
    resourceId INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unitPrice REAL NOT NULL DEFAULT 0,
    billedUnits REAL NOT NULL DEFAULT 0,
    priceType TEXT NOT NULL DEFAULT 'per_stay',
    totalPrice REAL NOT NULL DEFAULT 0,
    offered INTEGER NOT NULL DEFAULT 0,
    inComplement INTEGER NOT NULL DEFAULT 0,
    acompteContribTtc REAL DEFAULT NULL,
    soldeContribTtc REAL DEFAULT NULL,
    PRIMARY KEY (reservationId, resourceId)
  );
  CREATE TABLE reservation_nights (
    reservationId INTEGER NOT NULL,
    date TEXT NOT NULL,
    seasonLabel TEXT,
    pricingMode TEXT,
    price REAL NOT NULL DEFAULT 0
  );
`;

const RES_ID = 1;
const OPT_ID = 8;

function seed() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO options (id, title, description, price, priceType) VALUES (?, ?, ?, ?, ?)")
    .run(OPT_ID, 'Ménage', 'Ménage de fin de séjour', 50, 'per_stay');
  // Snapshot frozen at reservation-creation time: unit 50, total 50, billed, not offered.
  db.prepare(`INSERT INTO reservation_options
      (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
      VALUES (?, ?, 1, 50, 1, 'per_stay', 50, 0)`).run(RES_ID, OPT_ID);
  return db;
}

function snapshotLine(db) {
  const model = reservationsModel.create(db);
  return model.getPricingSnapshot(RES_ID).lockedOptionLines.find((l) => Number(l.optionId) === OPT_ID);
}

test('immutability: changing an option price does NOT change an existing reservation snapshot', () => {
  const db = seed();
  const before = snapshotLine(db);
  assert.equal(before.unitPrice, 50);
  assert.equal(before.totalPrice, 50);
  assert.equal(before.priceType, 'per_stay');
  assert.equal(before.offered, 0);

  db.prepare("UPDATE options SET price = 999, priceType = 'per_night' WHERE id = ?").run(OPT_ID);

  const after = snapshotLine(db);
  assert.equal(after.unitPrice, 50, 'unit price snapshot frozen');
  assert.equal(after.totalPrice, 50, 'total price snapshot frozen');
  assert.equal(after.priceType, 'per_stay', 'priceType snapshot frozen');
});

test('immutability: archiving an option does NOT change an existing reservation snapshot', () => {
  const db = seed();
  db.prepare("UPDATE options SET archivedAt = datetime('now') WHERE id = ?").run(OPT_ID);
  const after = snapshotLine(db);
  assert.equal(after.unitPrice, 50);
  assert.equal(after.totalPrice, 50);
  assert.equal(after.offered, 0);
});

test('immutability: later config changes on the catalog row do NOT flip an existing reservation\'s offered/total', () => {
  // The offered flag + amount are per-reservation snapshots; mutating the option later (here: price
  // to 0, as an "offered/inclus" toggle would imply) must not retro-change the reservation.
  const db = seed();
  db.prepare("UPDATE options SET price = 0 WHERE id = ?").run(OPT_ID);
  const after = snapshotLine(db);
  assert.equal(after.offered, 0, 'offered snapshot frozen');
  assert.equal(after.totalPrice, 50, 'total snapshot frozen');
});

test('libellé live (accepted exception, rule 7): renaming an option follows on display, amount stays frozen', () => {
  // The displayed label joins the live `options` row (same join getByIdWithDetails uses), so a
  // rename updates the label on existing reservations. This is the explicit Q2 "gel données,
  // libellé live" choice — no amount ever moves.
  const db = seed();
  db.prepare("UPDATE options SET title = 'Ménage Premium' WHERE id = ?").run(OPT_ID);
  const label = db.prepare(`
    SELECT o.title FROM reservation_options ro JOIN options o ON ro.optionId = o.id
    WHERE ro.reservationId = ? AND ro.optionId = ?`).get(RES_ID, OPT_ID);
  assert.equal(label.title, 'Ménage Premium', 'label follows the live catalog (cosmetic)');
  assert.equal(snapshotLine(db).totalPrice, 50, 'billed amount stays frozen');
});
