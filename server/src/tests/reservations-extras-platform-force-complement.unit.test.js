const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');

// specs/force-extras-complement-on-platform.md §3 rule 1 + §7.1.
// Validates the write-time invariant: on a non-direct platform reservation, every
// extra line (option, custom option, resource) lands with `inComplement = 1`
// regardless of what the payload says. Both contribs are nulled on forced lines.

// Minimal schema mirroring the columns the 3 INSERT statements use. The model's
// `readPlatformForcing` reads `reservations.platform` per write.
const DDL = `
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT
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
  CREATE TABLE reservation_custom_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    offered INTEGER NOT NULL DEFAULT 0,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    inComplement INTEGER NOT NULL DEFAULT 0,
    acompteContribTtc REAL DEFAULT NULL,
    soldeContribTtc REAL DEFAULT NULL
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
`;

function freshModel({ platform } = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  const stmt = db.prepare('INSERT INTO reservations (id, platform) VALUES (?, ?)');
  stmt.run(1, platform === undefined ? 'direct' : platform);
  const model = reservationsModel.create(db);
  return { model, db };
}

test('non-direct platform: replaceOptions forces inComplement = 1 even when the payload says 0', () => {
  const { model, db } = freshModel({ platform: 'Airbnb' });
  model.replaceOptions(1, [
    { optionId: 10, quantity: 1, unitPrice: 20, billedUnits: 1, priceType: 'per_stay', totalPrice: 20, offered: false, inComplement: false, acompteContribTtc: 7, soldeContribTtc: 13 },
  ]);
  const row = db.prepare('SELECT inComplement, acompteContribTtc, soldeContribTtc FROM reservation_options WHERE reservationId = 1 AND optionId = 10').get();
  assert.equal(row.inComplement, 1);
  // Forced lines null both contribs — guarantees the engine treats it as 100 % Complément.
  assert.equal(row.acompteContribTtc, null);
  assert.equal(row.soldeContribTtc, null);
});

test('non-direct platform: insertCustomOptions forces inComplement = 1 even when the payload says 0', () => {
  const { model, db } = freshModel({ platform: 'GitesDeFrance' });
  model.insertCustomOptions(1, [
    { isCustom: true, title: 'Late check-out', totalPrice: 15, originalTotalPrice: 15, offered: false, inComplement: false, acompteContribTtc: 5, soldeContribTtc: 10 },
  ]);
  const row = db.prepare('SELECT inComplement, acompteContribTtc, soldeContribTtc FROM reservation_custom_options WHERE reservationId = 1').get();
  assert.equal(row.inComplement, 1);
  assert.equal(row.acompteContribTtc, null);
  assert.equal(row.soldeContribTtc, null);
});

test('non-direct platform: insertResourceLine forces inComplement = 1 even when the payload says 0', () => {
  const { model, db } = freshModel({ platform: 'Booking' });
  model.insertResourceLine(1, { resourceId: 30, billedUnits: 2, totalPrice: 40, offered: false, inComplement: false, acompteContribTtc: 12, soldeContribTtc: 28 }, 20, 2, 'per_hour');
  const row = db.prepare('SELECT inComplement, acompteContribTtc, soldeContribTtc FROM reservation_resources WHERE reservationId = 1 AND resourceId = 30').get();
  assert.equal(row.inComplement, 1);
  assert.equal(row.acompteContribTtc, null);
  assert.equal(row.soldeContribTtc, null);
});

test('direct reservation: payload inComplement = 0 is honoured (no forcing)', () => {
  const { model, db } = freshModel({ platform: 'direct' });
  model.replaceOptions(1, [
    { optionId: 10, quantity: 1, unitPrice: 20, billedUnits: 1, priceType: 'per_stay', totalPrice: 20, offered: false, inComplement: false, acompteContribTtc: 6, soldeContribTtc: 14 },
  ]);
  const row = db.prepare('SELECT inComplement, acompteContribTtc, soldeContribTtc FROM reservation_options WHERE reservationId = 1 AND optionId = 10').get();
  assert.equal(row.inComplement, 0);
  // Direct + unforced → contribs preserved.
  assert.equal(row.acompteContribTtc, 6);
  assert.equal(row.soldeContribTtc, 14);
});

test('direct reservation: payload inComplement = 1 is honoured (operator opt-in)', () => {
  const { model, db } = freshModel({ platform: 'direct' });
  model.replaceOptions(1, [
    { optionId: 10, quantity: 1, unitPrice: 20, billedUnits: 1, priceType: 'per_stay', totalPrice: 20, offered: false, inComplement: true, acompteContribTtc: 6, soldeContribTtc: 14 },
  ]);
  const row = db.prepare('SELECT inComplement, acompteContribTtc, soldeContribTtc FROM reservation_options WHERE reservationId = 1 AND optionId = 10').get();
  assert.equal(row.inComplement, 1);
  assert.equal(row.acompteContribTtc, null);
  assert.equal(row.soldeContribTtc, null);
});

test('empty-string platform = direct (no forcing) — defensive against legacy data', () => {
  const { model, db } = freshModel({ platform: '' });
  model.replaceOptions(1, [
    { optionId: 10, quantity: 1, unitPrice: 20, billedUnits: 1, priceType: 'per_stay', totalPrice: 20, offered: false, inComplement: false, acompteContribTtc: 6, soldeContribTtc: 14 },
  ]);
  const row = db.prepare('SELECT inComplement FROM reservation_options WHERE reservationId = 1 AND optionId = 10').get();
  assert.equal(row.inComplement, 0);
});
