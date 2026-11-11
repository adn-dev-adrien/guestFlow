// specs/single-payment-from-the-fiche.md rule 9 reading of 2026-11-10 (verification R44 L4) — the two mid-stay note
// refusals name the remainder in French money (« 12,50 € »), never a dot decimal: settling a note above what is left,
// and raising a stored note above what its own lines have left.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createReservationsModel } = require('../models/reservationsModel');
const { MID_STAY_SOURCE } = require('../utils/midStayExtras');

const isoDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

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
  db.prepare('INSERT INTO reservations (id, startDate, endDate) VALUES (1, ?, ?)').run(isoDay(-1), isoDay(3));
  const model = createReservationsModel(db);
  model.syncMidStayComplement(1, [
    { label: 'Bière', unitPrice: 6.25, amount: 12.5, key: 'opt:12', source: MID_STAY_SOURCE },
  ]);
  return { db, model };
}

const refusal = (code, message) => (err) => err.code === code && err.message === message;

test('a note above what is left names the remainder in French money', () => {
  const { model } = makeDb();
  assert.throws(
    () => model.settleMidStayNote(1, { items: [{ key: 'opt:12', amount: 20 }] }),
    refusal('NOTE_AMOUNT_INVALID', 'Montant supérieur au reste à percevoir (12,50 €).'),
  );
});

test('a stored note raised above its lines names their remainder in French money', () => {
  const { db, model } = makeDb();
  model.settleMidStayNote(1, { items: [{ key: 'opt:12', amount: 6.25 }] });
  const note = JSON.parse(db.prepare('SELECT midStaySettledNotes FROM reservations WHERE id = 1').get().midStaySettledNotes)[0];
  assert.throws(
    () => model.adjustMidStayNote(1, { id: note.id, total: 20 }),
    refusal('NOTE_AMOUNT_INVALID', 'Montant supérieur au reste à percevoir sur ces prestations (12,50 €).'),
  );
});
