/**
 * specs/sas-bath-linen-ghost-line.md + specs/frozen-complement-trusts-client.md — the two pure
 * helpers behind the boot repairs, and the repairs themselves against a real SQLite schema.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { dropBathLinenGhost } = require('../utils/bathLinenGhostLine');
const { repairFrozenComplement } = require('../utils/frozenComplementRepair');
const { repairBathLinenGhosts, repairFrozenComplements } = require('../utils/complementDataRepairs');

const GHOST = { label: 'Linge de toilette', amount: 40, qty: 5, unitPrice: 8, source: 'arrivalBathLinen' };
const DEPARTURE = { label: 'Ménage de fin de séjour', amount: 30, qty: 1, unitPrice: 30 };
const MID_STAY = { label: 'Blonde du Pilat', amount: 6.5, qty: 1, unitPrice: 6.5, source: 'midStayExtra', key: 'opt:18' };

// ---- dropBathLinenGhost (pure) ----

test('dropBathLinenGhost: drops the ghost line and recomputes the amount', () => {
  const out = dropBathLinenGhost(JSON.stringify([DEPARTURE, GHOST, MID_STAY]));
  assert.deepEqual(out.detail, [DEPARTURE, MID_STAY]);
  assert.equal(out.amount, 36.5);
  assert.equal(out.dropped, 1);
});

test('dropBathLinenGhost: a detail with no ghost returns null (nothing to write)', () => {
  assert.equal(dropBathLinenGhost(JSON.stringify([DEPARTURE, MID_STAY])), null);
  assert.equal(dropBathLinenGhost(null), null);
  assert.equal(dropBathLinenGhost('not json'), null);
  assert.equal(dropBathLinenGhost('[]'), null);
});

test('dropBathLinenGhost: a detail made only of ghosts empties out at 0', () => {
  const out = dropBathLinenGhost(JSON.stringify([GHOST, { ...GHOST, amount: 8 }]));
  assert.deepEqual(out.detail, []);
  assert.equal(out.amount, 0);
  assert.equal(out.dropped, 2);
});

// ---- repairFrozenComplement (pure) ----

test('repairFrozenComplement: a frozen complement is reduced by the forced mid-stay part', () => {
  assert.deepEqual(
    repairFrozenComplement({ complementAmount: 30.5, complementPaid: 1, midStayForced: 6.5 }),
    { amount: 24, floored: false },
  );
});

test('repairFrozenComplement: untouched when not frozen or with no mid-stay part', () => {
  assert.equal(repairFrozenComplement({ complementAmount: 30.5, complementPaid: 0, midStayForced: 6.5 }), null);
  assert.equal(repairFrozenComplement({ complementAmount: 30.5, complementPaid: 1, midStayForced: 0 }), null);
  assert.equal(repairFrozenComplement({}), null);
});

test('repairFrozenComplement: a mid-stay part larger than the complement floors at 0', () => {
  assert.deepEqual(
    repairFrozenComplement({ complementAmount: 5, complementPaid: 1, midStayForced: 12 }),
    { amount: 0, floored: true },
  );
});

// ---- the boot repairs, against a real schema ----

const DDL = `
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0,
    arrivalExtrasBaseline TEXT,
    endOfStayComplementAmount REAL DEFAULT 0, endOfStayComplementDetail TEXT,
    endOfStayComplementPaid INTEGER DEFAULT 0, endOfStayComplementPaidCash INTEGER DEFAULT 0,
    updatedAt TEXT
  );
  CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, totalPrice REAL, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0);
  CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, totalPrice REAL, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0);
  CREATE TABLE reservation_custom_options (reservationId INTEGER, description TEXT, amount REAL, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0);
`;

function freshDb() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return db;
}

test('repairBathLinenGhosts: clears the ghost, keeps the other lines, and is idempotent', () => {
  const db = freshDb();
  db.prepare('INSERT INTO reservations (id, endOfStayComplementAmount, endOfStayComplementDetail) VALUES (1, 70, ?)')
    .run(JSON.stringify([DEPARTURE, GHOST]));
  // A reservation with a legitimate detail must not be rewritten.
  db.prepare('INSERT INTO reservations (id, endOfStayComplementAmount, endOfStayComplementDetail) VALUES (2, 30, ?)')
    .run(JSON.stringify([DEPARTURE]));

  assert.deepEqual(repairBathLinenGhosts(db), [1]);
  const row = db.prepare('SELECT endOfStayComplementAmount a, endOfStayComplementDetail d FROM reservations WHERE id = 1').get();
  assert.equal(row.a, 30);
  assert.deepEqual(JSON.parse(row.d), [DEPARTURE]);
  assert.equal(db.prepare('SELECT endOfStayComplementAmount a FROM reservations WHERE id = 2').get().a, 30);

  assert.deepEqual(repairBathLinenGhosts(db), []); // second pass: nothing left
});

test('repairBathLinenGhosts: a detail left empty is stored as NULL', () => {
  const db = freshDb();
  db.prepare('INSERT INTO reservations (id, endOfStayComplementAmount, endOfStayComplementDetail) VALUES (1, 40, ?)')
    .run(JSON.stringify([GHOST]));
  repairBathLinenGhosts(db);
  const row = db.prepare('SELECT endOfStayComplementAmount a, endOfStayComplementDetail d FROM reservations WHERE id = 1').get();
  assert.equal(row.a, 0);
  assert.equal(row.d, null);
});

test('repairFrozenComplements: the collected complement drops the mid-stay part it absorbed', () => {
  const db = freshDb();
  // Reservation #22269's shape: baseline without opt:18, the beer sold during the stay and forced to
  // the complement, complement collected by the arrival SAS.
  db.prepare(`INSERT INTO reservations
    (id, complementAmount, complementPaid, arrivalExtrasBaseline, endOfStayComplementAmount, endOfStayComplementDetail)
    VALUES (1, 30.5, 1, ?, 6.5, ?)`)
    .run(JSON.stringify({ 'opt:9': 24 }), JSON.stringify([MID_STAY]));
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, totalPrice, inComplement) VALUES (1, 9, 24, 1), (1, 18, 6.5, 1)').run();

  assert.deepEqual(repairFrozenComplements(db), [1]);
  assert.equal(db.prepare('SELECT complementAmount c FROM reservations WHERE id = 1').get().c, 24);
});

test('repairFrozenComplements: leaves an unpaid complement and a mid-stay-free reservation alone', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO reservations
    (id, complementAmount, complementPaid, arrivalExtrasBaseline, endOfStayComplementDetail)
    VALUES (1, 30.5, 0, ?, ?)`)
    .run(JSON.stringify({ 'opt:9': 24 }), JSON.stringify([MID_STAY]));
  db.prepare('INSERT INTO reservations (id, complementAmount, complementPaid, endOfStayComplementDetail) VALUES (2, 40, 1, ?)')
    .run(JSON.stringify([DEPARTURE]));
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, totalPrice, inComplement) VALUES (1, 9, 24, 1), (1, 18, 6.5, 1)').run();

  assert.deepEqual(repairFrozenComplements(db), []);
  assert.equal(db.prepare('SELECT complementAmount c FROM reservations WHERE id = 1').get().c, 30.5);
  assert.equal(db.prepare('SELECT complementAmount c FROM reservations WHERE id = 2').get().c, 40);
});
