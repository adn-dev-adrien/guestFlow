// specs/pricing-components.md §3 rule 79 — line identity: a fiche save keeps the number (`lineId`) and every column the
// writer does not know of each catalogue line it still sells, keeps the id of a custom line, writes exactly what the old
// DELETE + INSERT wrote, in the same physical order, and deletes only the lines that left the booking.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const bookingLines = require('../models/bookingLinesModel');
const { runPricingLinesMigration } = require('../utils/pricingLinesMigration');

const DDL = `
  CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, priceType TEXT, showsPlanningCard INTEGER DEFAULT 0, displayToClient INTEGER DEFAULT 1,
    countsAsBedLinen INTEGER DEFAULT 0, countsAsBathroomLinen INTEGER DEFAULT 0, countsAsBathMat INTEGER DEFAULT 0);
  CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, priceType TEXT);
  CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT DEFAULT 'reservation', platform TEXT, createdAt TEXT, finalPrice REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0, tariffSnapshot TEXT);
  CREATE TABLE reservation_options (
    reservationId INTEGER NOT NULL, optionId INTEGER NOT NULL, quantity REAL DEFAULT 1, unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0,
    priceType TEXT NOT NULL DEFAULT 'per_stay', totalPrice REAL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0,
    acompteContribTtc REAL, soldeContribTtc REAL, cardOccurrences TEXT, sasArrivalOrigin INTEGER NOT NULL DEFAULT 0, cardPersons REAL, cardNights REAL,
    PRIMARY KEY (reservationId, optionId));
  CREATE TABLE reservation_resources (
    reservationId INTEGER NOT NULL, resourceId INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, unitPrice REAL NOT NULL DEFAULT 0, billedUnits REAL NOT NULL DEFAULT 0,
    priceType TEXT NOT NULL DEFAULT 'per_stay', totalPrice REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, inComplement INTEGER NOT NULL DEFAULT 0,
    acompteContribTtc REAL, soldeContribTtc REAL, sessions TEXT, PRIMARY KEY (reservationId, resourceId));
  CREATE TABLE reservation_custom_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0,
    sortOrder INTEGER NOT NULL DEFAULT 0, createdAt TEXT DEFAULT (datetime('now')), updatedAt TEXT DEFAULT (datetime('now')), inComplement INTEGER NOT NULL DEFAULT 0,
    acompteContribTtc REAL, soldeContribTtc REAL, sasArrivalOrigin INTEGER NOT NULL DEFAULT 0, sasLineKey TEXT, quantity REAL NOT NULL DEFAULT 1);
  CREATE TABLE reservation_nights (reservationId INTEGER, date TEXT, seasonLabel TEXT, pricingMode TEXT, price REAL);
  INSERT INTO options (id, title, priceType) VALUES (1, 'A', 'per_stay'), (2, 'B', 'per_stay'), (3, 'C', 'per_stay');
  INSERT INTO resources (id, name, priceType) VALUES (7, 'Spa', 'per_stay'), (8, 'Sauna', 'per_stay');
  INSERT INTO reservations (id, createdAt) VALUES (1, '2026-01-01 08:00:00'), (2, '2026-01-02 08:00:00');
`;

function build({ migrate = true } = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  if (migrate) runPricingLinesMigration(db);
  return { db, store: bookingLines.buildModel(db) };
}

const opt = (optionId, totalPrice, extra = {}) => ({ optionId, quantity: 1, unitPrice: totalPrice, billedUnits: 1, priceType: 'per_stay', totalPrice, ...extra });
const res = (resourceId, totalPrice, extra = {}) => ({ resourceId, quantity: 1, unitPrice: totalPrice, billedUnits: 1, priceType: 'per_stay', totalPrice, ...extra });
const custom = (title, totalPrice, extra = {}) => ({ isCustom: true, title, originalTotalPrice: totalPrice, totalPrice, ...extra });
const options = (db) => db.prepare('SELECT * FROM reservation_options WHERE reservationId = 1 ORDER BY optionId').all();

const numbers = (db) => Object.fromEntries(db.prepare('SELECT optionId, lineId FROM reservation_options WHERE reservationId = 1').all().map((r) => [r.optionId, r.lineId]));

test('rule 79: a save keeps the number of an article it still sells, and every column the writer does not know', () => {
  const { db, store } = build();
  store.replaceOptions(1, [opt(1, 10), opt(2, 20)]);
  db.prepare("UPDATE reservation_options SET collectAt = 'departure', soldAt = '2026-01-01', articleRef = 'option:1', label = 'A', discountCents = 150, allowanceUsed = '{\"minutes\":30}', vatRate = 5.5 WHERE optionId = 1").run();
  const [first, second] = options(db);
  store.replaceOptions(1, [opt(1, 12, { quantity: 2, billedUnits: 2 }), opt(2, 20)]);
  const [after1, after2] = options(db);
  assert.equal(after1.lineId, first.lineId);
  assert.equal(after2.lineId, second.lineId);
  assert.equal(after1.totalPrice, 12);
  assert.equal(after1.quantity, 2);
  assert.deepEqual({ ...after1, totalPrice: 0, quantity: 0, billedUnits: 0, unitPrice: 0 }, { ...first, totalPrice: 0, quantity: 0, billedUnits: 0, unitPrice: 0 }, 'every other column is carried across');
  assert.equal(after1.collectAt, 'departure');
  assert.equal(after1.discountCents, 150);
});

test('rule 79: a line that left the booking is gone, a new one takes a new number, never one that was given before', () => {
  const { db, store } = build();
  store.replaceOptions(1, [opt(1, 10), opt(2, 20)]);
  const before = numbers(db);
  store.replaceOptions(1, [opt(2, 20), opt(3, 5)]);
  const after = numbers(db);
  assert.deepEqual(Object.keys(after), ['2', '3']);
  assert.equal(after[2], before[2]);
  assert.ok(after[3] > Math.max(...Object.values(before)));
  store.replaceOptions(1, []);
  assert.deepEqual(options(db), []);
  store.replaceOptions(1, [opt(1, 10)]);
  assert.ok(numbers(db)[1] > after[3], 'article 1 left and came back: it is a new line');
});

test('rule 79: the other booking is never touched, and the SAS marker of a line that stays is kept', () => {
  const { db, store } = build();
  store.replaceOptions(1, [opt(1, 10), opt(2, 20)]);
  store.replaceOptions(2, [opt(1, 99)]);
  db.prepare('UPDATE reservation_options SET sasArrivalOrigin = 1 WHERE reservationId = 1 AND optionId = 2').run();
  store.replaceOptions(1, [opt(2, 25)]);
  assert.deepEqual(options(db).map((r) => [r.optionId, r.sasArrivalOrigin, r.totalPrice]), [[2, 1, 25]]);
  assert.equal(db.prepare('SELECT totalPrice FROM reservation_options WHERE reservationId = 2').get().totalPrice, 99);
});

test('rule 79: the rows come back in the order of the save, as the old DELETE + INSERT left them (readers that sort nothing)', () => {
  const { db, store } = build();
  store.replaceOptions(1, [opt(2, 20), opt(3, 5)]);
  store.replaceOptions(1, [opt(1, 10), opt(2, 20), opt(3, 5)]);
  assert.deepEqual(db.prepare('SELECT optionId FROM reservation_options WHERE reservationId = 1 ORDER BY rowid').all().map((r) => r.optionId), [1, 2, 3]);
});

test('rule 79: a save writes exactly the values the old DELETE + INSERT wrote', () => {
  const lines = [opt(1, 10, { cardOccurrences: [{ date: '2026-01-06' }], cardPersons: 2, inComplement: 1, acompteContribTtc: 3 }), opt(2, 0, { offered: true }), opt(3, 7, { acompteContribTtc: 2, soldeContribTtc: 5 })];
  const migrated = build();
  migrated.store.replaceOptions(1, [opt(1, 1), opt(3, 1)]);
  migrated.store.replaceOptions(1, lines);
  const legacy = build({ migrate: false });
  legacy.store.replaceOptions(1, [opt(1, 1), opt(3, 1)]);
  legacy.store.replaceOptions(1, lines);
  const columns = ['reservationId', 'optionId', 'quantity', 'unitPrice', 'billedUnits', 'priceType', 'totalPrice', 'offered', 'inComplement', 'acompteContribTtc', 'soldeContribTtc', 'cardOccurrences', 'sasArrivalOrigin', 'cardPersons', 'cardNights'];
  const pick = (rows) => rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c]])));
  assert.deepEqual(pick(options(migrated.db)), pick(options(legacy.db)));
});

test('rule 79: resource lines keep their number through the controller\'s sequence (delete, then write each line sold again) and through replaceResources', () => {
  const { db, store } = build();
  store.replaceResources(1, [res(7, 40, { sessions: [{ date: '2026-01-06' }] }), res(8, 15)]);
  const before = db.prepare('SELECT * FROM reservation_resources WHERE reservationId = 1 ORDER BY resourceId').all();
  db.prepare("UPDATE reservation_resources SET collectAt = 'arrival', soldAt = '2026-01-01' WHERE resourceId = 7").run();
  const carried = store.deleteResources(1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_resources').get().n, 0);
  store.insertResourceLine(1, res(7, 45), 45, 1, 'per_stay', carried.get(7));
  store.insertResourceLine(1, res(9, 5), 5, 1, 'per_stay', carried.get(9));
  const after = db.prepare('SELECT * FROM reservation_resources WHERE reservationId = 1 ORDER BY resourceId').all();
  assert.equal(after[0].lineId, before[0].lineId);
  assert.equal(after[0].totalPrice, 45);
  assert.equal(after[0].collectAt, 'arrival');
  assert.ok(after[1].lineId > before[1].lineId, 'resource 8 left; 9 is a new line');
  store.replaceResources(1, [res(7, 50)]);
  const again = db.prepare('SELECT lineId, totalPrice FROM reservation_resources WHERE reservationId = 1').all();
  assert.deepEqual(again, [{ lineId: before[0].lineId, totalPrice: 50 }]);
});

test('rule 79: custom lines take the number and the sale columns of the stored line of the same text, the SAS marker with them; a renamed line is a new line', () => {
  const { db, store } = build();
  store.insertCustomOptions(1, [custom('Tisane', 6), custom('Miel', 4), custom('Tisane', 3)]);
  db.prepare("UPDATE reservation_custom_options SET sasArrivalOrigin = 1, sasLineKey = 'k1', quantity = 3, collectAt = 'departure', soldAt = '2026-01-03 09:00:00' WHERE description = 'Miel'").run();
  const before = db.prepare('SELECT * FROM reservation_custom_options ORDER BY id').all();
  store.replaceCustomOptions(1, [custom('Miel', 5), custom('Tisane', 7), custom('Thé', 2)]);
  const after = db.prepare('SELECT * FROM reservation_custom_options ORDER BY sortOrder').all();
  assert.deepEqual(after.map((r) => [r.description, r.amount, r.sortOrder]), [['Miel', 5, 0], ['Tisane', 7, 1], ['Thé', 2, 2]]);
  const [miel, tisane, the] = after;
  assert.equal(miel.lineId, before[1].lineId);
  assert.deepEqual([miel.sasArrivalOrigin, miel.sasLineKey, miel.quantity, miel.collectAt, miel.soldAt], [1, 'k1', 3, 'departure', '2026-01-03 09:00:00']);
  assert.equal(tisane.lineId, before[0].lineId, 'the first stored line of that text is taken first');
  assert.ok(the.lineId > Math.max(...before.map((r) => r.lineId)), 'a new text is a new line');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options').get().n, 3, 'the second « Tisane » is gone');
  store.replaceCustomOptions(1, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options').get().n, 0);
});

test('rule 79: the controller\'s sequence for the custom lines (delete, then insert with what the delete returned) carries them too', () => {
  const { db, store } = build();
  store.insertCustomOptions(1, [custom('Tisane', 6)]);
  const number = db.prepare('SELECT lineId FROM reservation_custom_options').get().lineId;
  const labels = store.sasOriginCustomLabels(1);
  const carried = store.deleteCustomOptions(1);
  store.insertCustomOptions(1, [custom('Tisane', 8)], labels, carried);
  assert.deepEqual(db.prepare('SELECT lineId, amount FROM reservation_custom_options').get(), { lineId: number, amount: 8 });
});

test('rule 79: a line that is not a SAS line is written with the defaults the insert gave it', () => {
  const { db, store } = build();
  store.insertCustomOptions(1, [custom('Tisane', 6)]);
  store.replaceCustomOptions(1, [custom('Tisane', 6)]);
  assert.deepEqual(db.prepare('SELECT sasArrivalOrigin, sasLineKey, quantity FROM reservation_custom_options').get(), { sasArrivalOrigin: 0, sasLineKey: null, quantity: 1 });
});

test('rule 79: copying a booking\'s lines onto another keeps the target\'s rows for the articles they share', () => {
  const { db, store } = build();
  store.replaceOptions(1, [opt(1, 10), opt(2, 20)]);
  store.replaceResources(1, [res(7, 40)]);
  store.replaceOptions(2, [opt(2, 1), opt(3, 1)]);
  const kept = db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = 2 AND optionId = 2').get().lineId;
  store.copyLineGraph(1, 2);
  const target = db.prepare('SELECT lineId, optionId, totalPrice FROM reservation_options WHERE reservationId = 2 ORDER BY optionId').all();
  assert.deepEqual(target.map((r) => [r.optionId, r.totalPrice]), [[1, 10], [2, 20]]);
  assert.equal(target[1].lineId, kept);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_resources WHERE reservationId = 2').get().n, 1);
});

test('rule 79: a schema without the new columns carries nothing and still saves', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE reservation_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, optionId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL,
    priceType TEXT, totalPrice REAL, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL);
    CREATE TABLE reservation_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, resourceId INTEGER, quantity REAL, unitPrice REAL, billedUnits REAL, priceType TEXT, totalPrice REAL);`);
  const store = bookingLines.buildModel(db);
  store.replaceOptions(1, [opt(1, 10), opt(2, 20)]);
  store.replaceOptions(1, [opt(2, 25)]);
  assert.deepEqual(db.prepare('SELECT optionId, totalPrice FROM reservation_options').all(), [{ optionId: 2, totalPrice: 25 }]);
  store.replaceResources(1, [res(7, 1)]);
  store.replaceResources(1, [res(8, 1)]);
  assert.deepEqual(db.prepare('SELECT resourceId FROM reservation_resources').all(), [{ resourceId: 8 }]);
});
