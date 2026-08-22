/**
 * specs/adjustable-complement-amounts.md §3.4 — modifier une note en séjour (montant, date, mode).
 * L'invariant vérifié partout : `Σ notes + reste à percevoir` ne change jamais. Baisser une note ne
 * détruit pas d'argent, elle le remet à percevoir au départ.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel } = require('../models/reservationsModel');
const { MID_STAY_SOURCE } = require('../utils/midStayExtras');

const round2 = (n) => Math.round(n * 100) / 100;

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
      propertyId INTEGER, startDate TEXT, endDate TEXT,
      complementAmount REAL NOT NULL DEFAULT 0, complementPaid INTEGER NOT NULL DEFAULT 0,
      complementAmountOverride REAL, endOfStayComplementAmountOverride REAL, complementAllocation TEXT,
      endOfStayComplementAmount REAL NOT NULL DEFAULT 0, endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0,
      endOfStayComplementPaidCash INTEGER NOT NULL DEFAULT 0, endOfStayComplementDetail TEXT,
      arrivalExtrasBaseline TEXT DEFAULT NULL, midStaySettledNotes TEXT DEFAULT NULL,
      updatedAt TEXT
    );
  `);
  db.prepare("INSERT INTO reservations (id, startDate, endDate) VALUES (1, '2026-07-10', '2026-07-15')").run();
  const model = createReservationsModel(db);
  // Deux prestations vendues en séjour : 26 € de linge + 13 € de bière.
  model.syncMidStayComplement(1, [
    { label: 'Linge de toilette', unitPrice: 26, amount: 26, key: 'opt:9', source: MID_STAY_SOURCE },
    { label: 'Bière', unitPrice: 6.5, amount: 13, key: 'opt:12', source: MID_STAY_SOURCE },
  ]);
  return { db, model };
}

const row = (db) => db.prepare('SELECT endOfStayComplementAmount AS amount, endOfStayComplementDetail AS detail, midStaySettledNotes AS notes FROM reservations WHERE id = 1').get();
const notesOf = (db) => JSON.parse(row(db).notes || '[]');
const notesTotal = (db) => round2(notesOf(db).reduce((s, n) => s + Number(n.total || 0), 0));

test('règle 25 — baisser une note remet la différence à percevoir en fin de séjour', () => {
  const { db, model } = makeDb();
  model.settleMidStayNote(1, { items: [{ key: 'opt:9', amount: 26 }] });
  assert.equal(row(db).amount, 13, 'reste : la bière');
  assert.equal(notesTotal(db), 26);

  const note = notesOf(db)[0];
  model.adjustMidStayNote(1, { id: note.id, total: 20 });
  assert.equal(notesTotal(db), 20);
  assert.equal(row(db).amount, 19, '13 € de bière + 6 € de linge rendus');
  assert.equal(round2(notesTotal(db) + row(db).amount), 39, 'Σ notes + reste : invariant');
});

test('règle 25 — remonter une note reprend sur ses propres clés', () => {
  const { db, model } = makeDb();
  model.settleMidStayNote(1, { items: [{ key: 'opt:9', amount: 20 }] });
  const note = notesOf(db)[0];
  model.adjustMidStayNote(1, { id: note.id, total: 26 });
  assert.equal(notesTotal(db), 26);
  assert.equal(row(db).amount, 13);
});

test('règle 27 — au-delà du reste à percevoir de ses clés : NOTE_AMOUNT_INVALID', () => {
  const { db, model } = makeDb();
  model.settleMidStayNote(1, { items: [{ key: 'opt:9', amount: 26 }] });
  const note = notesOf(db)[0];
  assert.throws(
    () => model.adjustMidStayNote(1, { id: note.id, total: 30 }),
    (err) => err.code === 'NOTE_AMOUNT_INVALID' && /26/.test(err.message),
  );
  assert.equal(notesTotal(db), 26, 'rien n\'a bougé');
});

test('une note à 0 € ou négative est refusée — annuler la note est le geste prévu', () => {
  const { db, model } = makeDb();
  model.settleMidStayNote(1, { items: [{ key: 'opt:9', amount: 26 }] });
  const note = notesOf(db)[0];
  for (const total of [0, -5]) {
    assert.throws(() => model.adjustMidStayNote(1, { id: note.id, total }), (err) => err.code === 'NOTE_AMOUNT_INVALID');
  }
});

test('règle 24 — date et mode seuls : les montants ne bougent pas', () => {
  const { db, model } = makeDb();
  model.settleMidStayNote(1, { items: [{ key: 'opt:9', amount: 26 }], cash: false });
  const note = notesOf(db)[0];
  model.adjustMidStayNote(1, { id: note.id, paidDate: '2026-07-12', cash: true });
  const after = notesOf(db)[0];
  assert.equal(after.total, 26);
  assert.equal(after.paidDate, '2026-07-12');
  assert.equal(after.paidCash, 1);
  assert.equal(row(db).amount, 13);
});

test('règle 28 — complément de fin de séjour encaissé : END_OF_STAY_SETTLED', () => {
  const { db, model } = makeDb();
  model.settleMidStayNote(1, { items: [{ key: 'opt:9', amount: 26 }] });
  const note = notesOf(db)[0];
  db.prepare('UPDATE reservations SET endOfStayComplementPaid = 1 WHERE id = 1').run();
  assert.throws(() => model.adjustMidStayNote(1, { id: note.id, total: 20 }), (err) => err.code === 'END_OF_STAY_SETTLED');
});

test('note inconnue → NOTE_NOT_FOUND', () => {
  const { model } = makeDb();
  assert.throws(() => model.adjustMidStayNote(1, { id: 999, total: 5 }), (err) => err.code === 'NOTE_NOT_FOUND');
});

test('une note sur deux clés se re-consomme dans l\'ordre de ses lignes', () => {
  const { db, model } = makeDb();
  model.settleMidStayNote(1, { items: [{ key: 'opt:9', amount: 26 }, { key: 'opt:12', amount: 13 }] });
  assert.equal(row(db).amount, 0);
  const note = notesOf(db)[0];
  model.adjustMidStayNote(1, { id: note.id, total: 30 });
  const after = notesOf(db)[0];
  assert.equal(after.total, 30);
  assert.deepEqual(after.lines.map((l) => l.amount), [26, 4], 'la 1re clé est servie d\'abord');
  assert.equal(row(db).amount, 9);
});
