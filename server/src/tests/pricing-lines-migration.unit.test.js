// specs/pricing-components.md §3 rules 36, 74, 78, 79 and §5 — the line identity rebuild, the sale columns, the refund
// columns and tables, the allocations: additions and backfills from stored data, no amount rewritten, a second run changes
// nothing, and the previous release's writers still work on the migrated tables (self-update rule 31).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runPricingLinesMigration } = require('../utils/pricingLinesMigration');

// The schema as the previous release left it: composite keys on the two catalogue line tables, none of the new columns.
// (reservation_options keeps the key and the rows it has: nothing is rebuilt.)
const OLD_DDL = `
  CREATE TABLE platforms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, countsAsDirect INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT, showsPlanningCard INTEGER DEFAULT 0, isCancellationInsurance INTEGER DEFAULT 0);
  CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, priceType TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation', platform TEXT, createdAt TEXT, finalPrice REAL NOT NULL DEFAULT 0,
    touristTaxTotal REAL DEFAULT 0, arrivalExtrasBaseline TEXT,
    depositPaid INTEGER DEFAULT 0, depositPaidDate TEXT, depositAmount REAL DEFAULT 0, depositPaidCash INTEGER DEFAULT 0,
    balancePaid INTEGER DEFAULT 0, balancePaidDate TEXT, balanceAmount REAL DEFAULT 0, balancePaidCash INTEGER DEFAULT 0,
    accommodationAcompteContribTtc REAL, accommodationSoldeContribTtc REAL, touristTaxAcompteContribTtc REAL, touristTaxSoldeContribTtc REAL
  );
  CREATE TABLE reservation_options (
    reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL, quantity REAL DEFAULT 1, unitPrice REAL NOT NULL DEFAULT 0,
    billedUnits REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay',
    totalPrice REAL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL DEFAULT NULL, soldeContribTtc REAL DEFAULT NULL, cardOccurrences TEXT, sasArrivalOrigin INTEGER NOT NULL DEFAULT 0, cardPersons REAL, cardNights REAL,
    PRIMARY KEY (reservationId, optionId),
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE,
    FOREIGN KEY (optionId) REFERENCES options(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_reservation_options_reservationId ON reservation_options(reservationId);
  CREATE TABLE reservation_resources (
    reservationId INTEGER NOT NULL, resourceId INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, unitPrice REAL NOT NULL DEFAULT 0,
    billedUnits REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay',
    totalPrice REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0, acompteContribTtc REAL DEFAULT NULL, soldeContribTtc REAL DEFAULT NULL, sessions TEXT,
    PRIMARY KEY (reservationId, resourceId),
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE,
    FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE
  );
  CREATE TABLE reservation_custom_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0,
    sortOrder INTEGER NOT NULL DEFAULT 0, createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now')), inComplement INTEGER NOT NULL DEFAULT 0,
    acompteContribTtc REAL DEFAULT NULL, soldeContribTtc REAL DEFAULT NULL, sasArrivalOrigin INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE
  );
  CREATE TABLE reservation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, eventType TEXT NOT NULL DEFAULT 'update', changedFields TEXT NOT NULL DEFAULT '[]', createdAt TEXT);
  CREATE TABLE reservation_refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, refundDate TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'transfer',
    totalTtc REAL NOT NULL DEFAULT 0, reason TEXT DEFAULT '', createdAt TEXT DEFAULT (datetime('now')), afterCancellation INTEGER
  );
  CREATE TABLE reservation_refund_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT, refundId INTEGER NOT NULL, lineKey TEXT, label TEXT NOT NULL, bucket TEXT NOT NULL,
    quantity REAL, unitPrice REAL, amountTtc REAL NOT NULL, vatRate REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE cancellation_compensations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, origin TEXT NOT NULL DEFAULT 'platform', receivedAmount REAL, receivedDate TEXT
  );
  CREATE TABLE payment_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, amountCents INTEGER NOT NULL DEFAULT 0, paidAt TEXT, createdAt TEXT DEFAULT (datetime('now')),
    cancelReason TEXT, basketJson TEXT
  );
`;

function oldDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(OLD_DDL);
  return db;
}

function seed(db) {
  db.exec(`
    INSERT INTO platforms (name, countsAsDirect) VALUES ('Booking.com', 0), ('Site', 1);
    INSERT INTO options (id, title, priceType, showsPlanningCard) VALUES (1, 'Petit-déjeuner', 'per_person', 1), (2, 'Bois', 'per_stay', 0), (3, 'Bain', 'per_hour', 0);
    INSERT INTO resources (id, name, priceType) VALUES (5, 'Spa', 'per_stay');
    INSERT INTO reservations (id, kind, platform, createdAt, finalPrice, touristTaxTotal, arrivalExtrasBaseline) VALUES
      (10, 'reservation', 'direct', '2026-01-05 10:00:00', 400, 12, '{"opt:2":20}'),
      (11, 'reservation', 'Booking.com', '2026-02-05 10:00:00', 300, 0, NULL),
      (12, 'cancelled', 'Site', '2026-03-05 10:00:00', 150, 5, NULL);
    INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement, cardOccurrences) VALUES
      (10, 2, 1, 20, 1, 'per_stay', 35, 0, 1, NULL), (10, 1, 2, 10, 2, 'per_person', 20, 0, 0, '[{"date":"2026-01-06"}]'), (11, 3, 1, 15, 1, 'per_hour', 15, 0, 0, NULL);
    INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, inComplement) VALUES (10, 5, 1, 40, 1, 'per_stay', 40, 1);
    INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement, createdAt) VALUES (10, 'Tisane', 6, 1, '2026-01-07 09:00:00'), (11, 'Miel', 4, 0, '2026-02-06 09:00:00');
  `);
}

const rowsOf = (db, table, columns) => db.prepare(`SELECT ${columns.join(', ')} FROM ${table} ORDER BY rowid`).all();
const OPTION_VALUES = ['reservationId', 'optionId', 'quantity', 'unitPrice', 'billedUnits', 'priceType', 'totalPrice', 'offered', 'inComplement', 'acompteContribTtc', 'soldeContribTtc', 'cardOccurrences', 'sasArrivalOrigin', 'cardPersons', 'cardNights'];

test('rule 79: every catalogue line is numbered in rowid order, its row and its key left exactly as stored', () => {
  const db = oldDatabase();
  seed(db);
  db.prepare('UPDATE reservation_options SET acompteContribTtc = 1.5, soldeContribTtc = NULL, sasArrivalOrigin = 1, cardPersons = 2 WHERE optionId = 1').run();
  const before = rowsOf(db, 'reservation_options', OPTION_VALUES);
  const order = db.prepare('SELECT rowid, optionId FROM reservation_options ORDER BY rowid').all();
  const changes = runPricingLinesMigration(db);
  assert.equal(changes.lineIds, 6, 'three options, one resource, two free lines');
  assert.deepEqual(rowsOf(db, 'reservation_options', OPTION_VALUES), before);
  assert.deepEqual(db.prepare('SELECT rowid, optionId FROM reservation_options ORDER BY rowid').all(), order, 'the physical order the readers rely on is untouched');
  const numbers = db.prepare('SELECT lineId FROM reservation_options ORDER BY rowid').all().map((r) => r.lineId);
  assert.deepEqual(numbers, order.map((r) => r.rowid));
  assert.deepEqual(db.prepare('PRAGMA table_info(reservation_options)').all().filter((c) => c.pk > 0).map((c) => c.name), ['reservationId', 'optionId'], 'the primary key stays');
  assert.ok(db.prepare("SELECT 1 FROM pragma_index_list('reservation_options') WHERE name = 'idx_reservation_options_line_id' AND \"unique\" = 1").get());
});

test('rule 79: a number is never given twice: not to a new row, not after the last line was deleted, not by the previous release\'s writers', () => {
  const db = oldDatabase();
  seed(db);
  runPricingLinesMigration(db);
  const numberOf = (reservationId, optionId) => db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(reservationId, optionId).lineId;
  const highest = db.prepare('SELECT MAX(lineId) AS n FROM reservation_options').get().n;
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, totalPrice) VALUES (12, 1, 5)').run();
  assert.equal(numberOf(12, 1), highest + 1);
  db.prepare('DELETE FROM reservation_options WHERE reservationId = 12').run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, totalPrice) VALUES (12, 2, 5)').run();
  assert.equal(numberOf(12, 2), highest + 2, 'the number of a deleted line is not given again');
  const taken = db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = 10 AND optionId = 2').get().lineId;
  assert.throws(() => db.prepare('UPDATE reservation_options SET lineId = ? WHERE optionId = 2 AND reservationId = 12').run(taken), /UNIQUE/, 'two lines never share a number');
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, totalPrice) VALUES (11, 5, 5)').run();
  assert.equal(db.prepare('SELECT lineId FROM reservation_resources WHERE reservationId = 11').get().lineId, 2, 'each table counts on its own');
});

test('rule 36: a second run changes nothing, and no amount column is rewritten', () => {
  const db = oldDatabase();
  seed(db);
  const amounts = () => JSON.stringify([
    db.prepare('SELECT reservationId, optionId, unitPrice, totalPrice, acompteContribTtc, soldeContribTtc FROM reservation_options ORDER BY reservationId, optionId').all(),
    db.prepare('SELECT reservationId, resourceId, unitPrice, totalPrice FROM reservation_resources ORDER BY reservationId, resourceId').all(),
    db.prepare('SELECT id, amount FROM reservation_custom_options ORDER BY id').all(),
    db.prepare('SELECT id, finalPrice, touristTaxTotal, depositAmount, balanceAmount FROM reservations ORDER BY id').all(),
  ]);
  const before = amounts();
  const first = runPricingLinesMigration(db);
  assert.ok(first.columns > 0 && first.lineColumns > 0 && first.stayLines > 0);
  assert.equal(amounts(), before);
  assert.deepEqual(runPricingLinesMigration(db), { lineIds: 0, columns: 0, lineColumns: 0, stayLines: 0, refundColumns: 0, obligations: 0, allocations: 0 });
  assert.equal(amounts(), before);
});

test('rollback (self-update rule 31): the previous release\'s writers run unchanged on the migrated tables', () => {
  const db = oldDatabase();
  seed(db);
  runPricingLinesMigration(db);
  const upsert = db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(reservationId, optionId) DO UPDATE SET quantity = excluded.quantity, totalPrice = excluded.totalPrice`);
  const lineBefore = db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = 10 AND optionId = 2').get().lineId;
  upsert.run(10, 2, 3, 20, 3, 'per_stay', 60);
  assert.deepEqual(db.prepare('SELECT lineId, totalPrice FROM reservation_options WHERE reservationId = 10 AND optionId = 2').get(), { lineId: lineBefore, totalPrice: 60 });
  upsert.run(10, 3, 1, 15, 1, 'per_hour', 15);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = 10').get().n, 3);
  // The previous save: delete the booking's lines, insert them again without any new column.
  db.prepare('DELETE FROM reservation_options WHERE reservationId = 10').run();
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (10, 2, 1, 20, 1, 'per_stay', 20)").run();
  const row = db.prepare('SELECT * FROM reservation_options WHERE reservationId = 10').get();
  assert.ok(row.lineId > 0 && row.source === 'fiche' && row.discountCents === 0 && row.collectAt === null);
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, totalPrice) VALUES (11, 5, 9) ON CONFLICT(reservationId, resourceId) DO UPDATE SET totalPrice = excluded.totalPrice').run();
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, totalPrice) VALUES (11, 5, 12) ON CONFLICT(reservationId, resourceId) DO UPDATE SET totalPrice = excluded.totalPrice').run();
  assert.deepEqual(db.prepare('SELECT totalPrice FROM reservation_resources WHERE reservationId = 11').all(), [{ totalPrice: 12 }]);
  assert.throws(() => db.prepare('INSERT INTO reservation_options (reservationId, optionId) VALUES (10, 2)').run(), /UNIQUE/);
  assert.deepEqual(rowsOf(db, 'reservation_options', ['reservationId', 'optionId']).filter((r) => r.reservationId === 10), [{ reservationId: 10, optionId: 2 }]);
});

test('rules 37 and 74: every line gets its moment, its snapshot of what was sold and its sale date', () => {
  const db = oldDatabase();
  seed(db);
  runPricingLinesMigration(db);
  const option = (reservationId, optionId) => db.prepare('SELECT collectAt, collectAtDefault, soldAt, articleRef, family, label, source, discountCents FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(reservationId, optionId);
  // Stay 10 is direct with a baseline: `opt:2` (35) is above its 20 → departure, the spa and the tisane are not in it at all; the breakfast is a planning card.
  assert.deepEqual(option(10, 2), { collectAt: 'departure', collectAtDefault: 'departure', soldAt: '2026-01-05 10:00:00', articleRef: 'option:2', family: 'fixed', label: 'Bois', source: 'fiche', discountCents: 0 });
  assert.deepEqual(option(10, 1), { collectAt: 'plan', collectAtDefault: 'plan', soldAt: '2026-01-05 10:00:00', articleRef: 'option:1', family: 'perUnit', label: 'Petit-déjeuner', source: 'fiche', discountCents: 0 });
  // Stay 11 is a platform sale, outside the complement: inside the platform's price. an option stored `per_hour` (a resource price type, rule 47 reading of L6) reads as `fixed`.
  assert.deepEqual(option(11, 3), { collectAt: 'platform', collectAtDefault: 'platform', soldAt: '2026-02-05 10:00:00', articleRef: 'option:3', family: 'fixed', label: 'Bain', source: 'fiche', discountCents: 0 });
  assert.deepEqual(db.prepare('SELECT collectAt, articleRef, family, label FROM reservation_resources WHERE reservationId = 10').get(), { collectAt: 'departure', articleRef: 'resource:5', family: 'fixed', label: 'Spa' });
  const custom = db.prepare('SELECT lineId, collectAt, soldAt, articleRef, family, label FROM reservation_custom_options WHERE reservationId = 10').get();
  assert.deepEqual(custom, { lineId: custom.lineId, collectAt: 'departure', soldAt: '2026-01-07 09:00:00', articleRef: `custom:${custom.lineId}`, family: null, label: 'Tisane' });
});

test('rule 74: each stay holds its accommodation line (the final price less its extras) and, with a tax, its tourist-tax line', () => {
  const db = oldDatabase();
  seed(db);
  runPricingLinesMigration(db);
  const lines = db.prepare('SELECT reservationId, kind, label, totalCents, vatClass, soldAt FROM reservation_stay_lines ORDER BY reservationId, kind').all();
  assert.deepEqual(lines.map((l) => `${l.reservationId} ${l.kind} ${l.totalCents} ${l.vatClass}`), [
    '10 accommodation 29900 accommodation', '10 touristTax 1200 outOfScope', '11 accommodation 28100 accommodation',
    '12 accommodation 15000 accommodation', '12 touristTax 500 outOfScope',
  ]);
  assert.deepEqual(lines[0], { reservationId: 10, kind: 'accommodation', label: 'Hébergement', totalCents: 29900, vatClass: 'accommodation', soldAt: '2026-01-05 10:00:00' });
});

test('rule 14 of reservation-refunds and rule 74: the refund columns are backfilled from stored data and a refund is a negative allocation', () => {
  const db = oldDatabase();
  seed(db);
  db.exec(`
    INSERT INTO reservation_refunds (id, reservationId, refundDate, method, totalTtc) VALUES (1, 10, '2026-02-01', 'transfer', 25), (2, 12, '2026-03-10', 'retained', 90), (3, 10, '2026-02-03', 'internal', 5);
    INSERT INTO reservation_refund_lines (refundId, lineKey, label, bucket, amountTtc) VALUES
      (1, 'opt:2', 'Bois', 'options', 20), (1, NULL, 'Geste', 'accommodation', 5), (2, 'accommodation', 'Acompte', 'indemnity', 90),
      (2, 'commission', 'Commission', 'accommodation', 3), (3, 'res:5', 'Spa', 'resources', 5);
    INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES
      (12, 'cancel', '[{"field":"retainedDeposit","to":80},{"field":"keptFromGuest","to":90}]');
    UPDATE reservations SET kind = 'cancelled' WHERE id = 12;
  `);
  runPricingLinesMigration(db);
  assert.deepEqual(db.prepare('SELECT id, kind, origin, amountCents FROM reservation_refunds ORDER BY id').all(), [
    { id: 1, kind: 'refund', origin: 'operator', amountCents: 2500 }, { id: 2, kind: 'requalification', origin: 'cancellation', amountCents: 9000 },
    { id: 3, kind: 'refund', origin: 'operator', amountCents: 500 }]);
  const lines = db.prepare('SELECT refundId, lineKey, amountCents, source, revenueBucket FROM reservation_refund_lines ORDER BY id').all();
  assert.deepEqual(lines.map((l) => `${l.refundId} ${l.lineKey} ${l.amountCents} ${l.source} ${l.revenueBucket}`), [
    '1 opt:2 2000 sale options', '1 null 500 sale accommodation', '2 accommodation 9000 indemnity accommodation',
    '2 commission 300 commission accommodation', '3 res:5 500 sale resources']);
  const refs = db.prepare('SELECT lineKey, lineRef FROM reservation_refund_lines ORDER BY id').all();
  assert.match(refs[0].lineRef, /^line:reservation_options:\d+$/);
  assert.equal(refs[1].lineRef, null, 'a free line points at nothing');
  assert.match(refs[2].lineRef, /^line:reservation_stay_lines:\d+$/);
  assert.equal(refs[3].lineRef, null, 'a commission is not a sale line');
  assert.match(refs[4].lineRef, /^line:reservation_resources:\d+$/);
  assert.deepEqual(db.prepare('SELECT cancellationKeptCents, cancellationIndemnityCents FROM reservations WHERE id = 12').get(), { cancellationKeptCents: 9000, cancellationIndemnityCents: 9000 });
  assert.deepEqual(db.prepare('SELECT cancellationKeptCents FROM reservations WHERE id = 10').get(), { cancellationKeptCents: null });
  const refunds = db.prepare("SELECT paymentRef, lineRef, amountCents, refundId, books, origin FROM payment_allocations WHERE kind = 'refund' ORDER BY refundId, lineRef").all();
  assert.deepEqual(refunds.map((r) => `${r.refundId} ${r.paymentRef} ${r.lineRef ? 'line' : 'stay'} ${r.amountCents} ${r.books} ${r.origin}`).sort(), [
    '1 null line -2000 1 backfill', '1 null stay -500 1 backfill', '3 null line -500 0 backfill']);
});

test('rule 78: the compensation points at the avoir it mirrors', () => {
  const db = oldDatabase();
  seed(db);
  db.exec(`
    INSERT INTO reservation_refunds (id, reservationId, refundDate, method, totalTtc) VALUES (7, 12, '2026-03-10', 'retained', 90.0);
    INSERT INTO cancellation_compensations (reservationId, origin, receivedAmount, receivedDate) VALUES (12, 'retained_deposit', 90, '2026-03-10'), (12, 'retained_deposit', 80, '2026-03-10'), (12, 'platform', 90, '2026-03-10');
  `);
  runPricingLinesMigration(db);
  assert.deepEqual(db.prepare('SELECT refundId FROM cancellation_compensations ORDER BY id').all(), [{ refundId: 7 }, { refundId: null }, { refundId: null }]);
});

test('rule 75: a basket money owed back opens an obligation, a link refunded by the operator a settled one, once', () => {
  const db = oldDatabase();
  seed(db);
  db.exec(`
    INSERT INTO payment_links (id, reservationId, amountCents, paidAt, cancelReason, basketJson) VALUES
      (1, 10, 4000, '2026-02-01', NULL, '{"source":"shop","refundOwed":true}'), (2, 10, 5000, '2026-02-02', NULL, '{"source":"shop","refundOwed":true,"refundCents":1200}'),
      (3, 11, 3000, '2026-02-03', 'refunded', NULL), (4, 11, 2000, '2026-02-04', NULL, '{"source":"shop"}');
  `);
  runPricingLinesMigration(db);
  runPricingLinesMigration(db);
  assert.deepEqual(db.prepare('SELECT paymentLinkId, origin, amountCents, status, settledBy, settledAt FROM refund_obligations ORDER BY paymentLinkId').all(), [
    { paymentLinkId: 1, origin: 'basket', amountCents: 4000, status: 'open', settledBy: null, settledAt: null },
    { paymentLinkId: 2, origin: 'basket', amountCents: 1200, status: 'open', settledBy: null, settledAt: null },
    { paymentLinkId: 3, origin: 'withdrawnLink', amountCents: 3000, status: 'settled', settledBy: 'provider', settledAt: null }]);
});

test('rule 74: a paid bucket whose contribs describe it is allocated line by line; a refund and a payment never collide', () => {
  const db = oldDatabase();
  seed(db);
  db.exec(`
    UPDATE reservations SET balancePaid = 1, balancePaidDate = '2026-02-20', balanceAmount = 130, accommodationSoldeContribTtc = 90, touristTaxSoldeContribTtc = 10 WHERE id = 10;
    UPDATE reservation_options SET soldeContribTtc = 20 WHERE reservationId = 10 AND optionId = 1;
    UPDATE reservation_custom_options SET soldeContribTtc = 10 WHERE reservationId = 10;
    UPDATE reservations SET depositPaid = 1, depositPaidDate = '2026-01-10', depositAmount = 999 WHERE id = 10;
  `);
  runPricingLinesMigration(db);
  const rows = db.prepare("SELECT paymentRef, lineRef, amountCents, at, books FROM payment_allocations WHERE kind = 'payment' ORDER BY lineRef").all();
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.paymentRef === 'bucket:balance' && r.at === '2026-02-20' && r.books === 1));
  assert.equal(rows.reduce((sum, r) => sum + r.amountCents, 0), 13000);
  assert.ok(!db.prepare("SELECT 1 FROM payment_allocations WHERE paymentRef = 'bucket:deposit'").get(), 'a deposit whose contribs do not add up has no per-line truth');
  db.prepare('UPDATE reservation_options SET soldeContribTtc = 1 WHERE reservationId = 10 AND optionId = 1').run();
  assert.equal(runPricingLinesMigration(db).allocations, 0, 'an allocated payment is never written twice, even when its contribs moved');
});

test('rule 74: deleting a stay deletes its allocations, its stay lines and its obligations', () => {
  const db = oldDatabase();
  seed(db);
  db.exec(`
    UPDATE reservations SET balancePaid = 1, balancePaidDate = '2026-02-20', balanceAmount = 10, accommodationSoldeContribTtc = 10 WHERE id = 11;
    INSERT INTO payment_links (id, reservationId, amountCents, basketJson) VALUES (1, 11, 1000, '{"refundOwed":true}');
  `);
  runPricingLinesMigration(db);
  const counts = () => db.prepare(`SELECT (SELECT COUNT(*) FROM payment_allocations WHERE documentRef = 'reservation:11') AS allocations,
    (SELECT COUNT(*) FROM reservation_stay_lines WHERE reservationId = 11) AS stayLines, (SELECT COUNT(*) FROM refund_obligations WHERE reservationId = 11) AS obligations`).get();
  assert.deepEqual(counts(), { allocations: 1, stayLines: 1, obligations: 1 });
  db.prepare('DELETE FROM reservations WHERE id = 11').run();
  assert.deepEqual(counts(), { allocations: 0, stayLines: 0, obligations: 0 });
});

test('the migration degrades on a minimal schema: a table that is absent is skipped, nothing throws', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE reservations (id INTEGER PRIMARY KEY, finalPrice REAL, touristTaxTotal REAL)');
  assert.doesNotThrow(() => runPricingLinesMigration(db));
  assert.doesNotThrow(() => runPricingLinesMigration(db));
  const bare = new Database(':memory:');
  assert.doesNotThrow(() => runPricingLinesMigration(bare));
});
