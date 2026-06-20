const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');

// specs/force-extras-complement-on-platform.md §3 + §7.1.
// The write-time contract changed (rule 1bis): the pricing engine is the single authority for
// `inComplement` — it applies the platform default for unflagged lines AND honours an explicit
// operator override. The model therefore persists the engine-resolved flag VERBATIM and never
// re-forces by platform. This suite locks that: whatever `inComplement` the line carries is what
// lands in the DB (contribs nulled when in Complément), on direct AND platform reservations alike.

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

test('platform reservation: engine-resolved inComplement = 1 persists with NULL contribs', () => {
  const { model, db } = freshModel({ platform: 'Airbnb' });
  model.replaceOptions(1, [
    { optionId: 10, quantity: 1, unitPrice: 20, billedUnits: 1, priceType: 'per_stay', totalPrice: 20, offered: false, inComplement: 1, acompteContribTtc: 7, soldeContribTtc: 13 },
  ]);
  const row = db.prepare('SELECT inComplement, acompteContribTtc, soldeContribTtc FROM reservation_options WHERE reservationId = 1 AND optionId = 10').get();
  assert.equal(row.inComplement, 1);
  // In Complément → both contribs nulled (line lives 100 % in the Complément entry).
  assert.equal(row.acompteContribTtc, null);
  assert.equal(row.soldeContribTtc, null);
});

test('platform reservation: operator override inComplement = 0 is HONOURED (no re-forcing)', () => {
  // The core of spec rule 1bis: even on a platform reservation, a line the operator pulled OUT of
  // Complément (engine returns 0) must persist as 0 — the model no longer re-forces by platform.
  const { model, db } = freshModel({ platform: 'Airbnb' });
  model.replaceOptions(1, [
    { optionId: 10, quantity: 1, unitPrice: 20, billedUnits: 1, priceType: 'per_stay', totalPrice: 20, offered: false, inComplement: 0, acompteContribTtc: 7, soldeContribTtc: 13 },
  ]);
  const row = db.prepare('SELECT inComplement, acompteContribTtc, soldeContribTtc FROM reservation_options WHERE reservationId = 1 AND optionId = 10').get();
  assert.equal(row.inComplement, 0);
  // Out of Complément → contribs preserved for the deposit/balance split.
  assert.equal(row.acompteContribTtc, 7);
  assert.equal(row.soldeContribTtc, 13);
});

test('platform reservation: custom-option override inComplement = 0 is honoured', () => {
  const { model, db } = freshModel({ platform: 'GitesDeFrance' });
  model.insertCustomOptions(1, [
    { isCustom: true, title: 'Late check-out', totalPrice: 15, originalTotalPrice: 15, offered: false, inComplement: 0, acompteContribTtc: 5, soldeContribTtc: 10 },
  ]);
  const row = db.prepare('SELECT inComplement, acompteContribTtc, soldeContribTtc FROM reservation_custom_options WHERE reservationId = 1').get();
  assert.equal(row.inComplement, 0);
  assert.equal(row.acompteContribTtc, 5);
  assert.equal(row.soldeContribTtc, 10);
});

test('platform reservation: resource override inComplement = 0 is honoured', () => {
  const { model, db } = freshModel({ platform: 'Booking' });
  model.insertResourceLine(1, { resourceId: 30, billedUnits: 2, totalPrice: 40, offered: false, inComplement: 0, acompteContribTtc: 12, soldeContribTtc: 28 }, 20, 2, 'per_hour');
  const row = db.prepare('SELECT inComplement, acompteContribTtc, soldeContribTtc FROM reservation_resources WHERE reservationId = 1 AND resourceId = 30').get();
  assert.equal(row.inComplement, 0);
  assert.equal(row.acompteContribTtc, 12);
  assert.equal(row.soldeContribTtc, 28);
});

test('custom option in Complément (inComplement = 1) persists with NULL contribs', () => {
  const { model, db } = freshModel({ platform: 'GitesDeFrance' });
  model.insertCustomOptions(1, [
    { isCustom: true, title: 'Late check-out', totalPrice: 15, originalTotalPrice: 15, offered: false, inComplement: 1, acompteContribTtc: 5, soldeContribTtc: 10 },
  ]);
  const row = db.prepare('SELECT inComplement, acompteContribTtc, soldeContribTtc FROM reservation_custom_options WHERE reservationId = 1').get();
  assert.equal(row.inComplement, 1);
  assert.equal(row.acompteContribTtc, null);
  assert.equal(row.soldeContribTtc, null);
});

test('resource in Complément (inComplement = 1) persists with NULL contribs', () => {
  const { model, db } = freshModel({ platform: 'Booking' });
  model.insertResourceLine(1, { resourceId: 30, billedUnits: 2, totalPrice: 40, offered: false, inComplement: 1, acompteContribTtc: 12, soldeContribTtc: 28 }, 20, 2, 'per_hour');
  const row = db.prepare('SELECT inComplement, acompteContribTtc, soldeContribTtc FROM reservation_resources WHERE reservationId = 1 AND resourceId = 30').get();
  assert.equal(row.inComplement, 1);
  assert.equal(row.acompteContribTtc, null);
  assert.equal(row.soldeContribTtc, null);
});

test('direct reservation: payload inComplement = 0 is honoured (contribs preserved)', () => {
  const { model, db } = freshModel({ platform: 'direct' });
  model.replaceOptions(1, [
    { optionId: 10, quantity: 1, unitPrice: 20, billedUnits: 1, priceType: 'per_stay', totalPrice: 20, offered: false, inComplement: 0, acompteContribTtc: 6, soldeContribTtc: 14 },
  ]);
  const row = db.prepare('SELECT inComplement, acompteContribTtc, soldeContribTtc FROM reservation_options WHERE reservationId = 1 AND optionId = 10').get();
  assert.equal(row.inComplement, 0);
  assert.equal(row.acompteContribTtc, 6);
  assert.equal(row.soldeContribTtc, 14);
});

test('direct reservation: payload inComplement = 1 is honoured (operator opt-in)', () => {
  const { model, db } = freshModel({ platform: 'direct' });
  model.replaceOptions(1, [
    { optionId: 10, quantity: 1, unitPrice: 20, billedUnits: 1, priceType: 'per_stay', totalPrice: 20, offered: false, inComplement: 1, acompteContribTtc: 6, soldeContribTtc: 14 },
  ]);
  const row = db.prepare('SELECT inComplement, acompteContribTtc, soldeContribTtc FROM reservation_options WHERE reservationId = 1 AND optionId = 10').get();
  assert.equal(row.inComplement, 1);
  assert.equal(row.acompteContribTtc, null);
  assert.equal(row.soldeContribTtc, null);
});
