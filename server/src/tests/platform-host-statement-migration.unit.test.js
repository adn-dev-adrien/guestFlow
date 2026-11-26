// specs/platforms/platform-host-statement-and-commission-vat.md rule 4 — the stored brut of every platform stay becomes the host amount, and every
// stored price stays to the cent: the tax a brut held comes out of it (mode platform: the box; mode platform_reversed: the reversed tax).
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;
const { runHostStatementBrutMigration } = require('../utils/hostStatementBrutMigration');
const {
  createDb, addPlatform, FRAISSE, DAUSQUE,
} = require('./platformHostStatementFixture');

function storedDb(rows) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT UNIQUE, collectsTouristTax INTEGER, touristTaxRemittedByPlatform INTEGER);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, platform TEXT, platformGrossAmount REAL, platformTouristTaxAmount REAL,
      touristTaxTotal REAL, touristTaxAddedGuestsAmount REAL DEFAULT 0);
  `);
  db.exec("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES ('Airbnb', 1, 0), ('GitesDeFrance', 1, 1), ('Abracadaroom', 0, 0)");
  const insert = db.prepare('INSERT INTO reservations (id, platform, platformGrossAmount, platformTouristTaxAmount, touristTaxTotal, touristTaxAddedGuestsAmount) VALUES (?, ?, ?, ?, ?, ?)');
  for (const r of rows) insert.run(r.id, r.platform, r.brut, r.box, r.tax, r.added || 0);
  return db;
}
// The engine's own figure, as the tax slice gives it: the tax of the stay less what the guests added later paid.
const reversedTaxOf = (row) => Number(row.touristTaxTotal || 0) - Number(row.touristTaxAddedGuestsAmount || 0);
const read = (db, id) => db.prepare('SELECT platformGrossAmount AS brut, platformTouristTaxAmount AS box FROM reservations WHERE id = ?').get(id);

test('rule 4 — mode platform with a filled box: brut := brut − box, the box stays; no box, no change', () => {
  const db = storedDb([
    { id: 1, platform: 'GitesDeFrance', brut: 900, box: 36, tax: 0 },
    { id: 2, platform: 'GitesDeFrance', brut: 864, box: null, tax: 0 },
  ]);
  const { migrated } = runHostStatementBrutMigration(db, { reversedTaxOf });
  assert.deepEqual(migrated, [1]);
  assert.deepEqual(read(db, 1), { brut: 864, box: 36 });
  assert.deepEqual(read(db, 2), { brut: 864, box: null });
});

test('rule 4 — mode platform_reversed: brut := brut − T and box := T, T the reversed tax the engine subtracted (added guests excluded)', () => {
  const db = storedDb([
    { id: 1, platform: 'Airbnb', brut: 829, box: null, tax: 31.2, added: 7.2 },
    { id: 2, platform: 'Airbnb', brut: 700, box: 12, tax: 0 },
  ]);
  runHostStatementBrutMigration(db, { reversedTaxOf });
  assert.deepEqual(read(db, 1), { brut: 805, box: 24 });
  assert.deepEqual(read(db, 2), { brut: 700, box: null }, 'no tax in the brut: a stale box would be a phantom gap');
});

test('rule 4 — owner mode, direct stays and stays without a brut are not touched', () => {
  const db = storedDb([
    { id: 1, platform: 'Abracadaroom', brut: 500, box: 20, tax: 20 },
    { id: 2, platform: 'direct', brut: 500, box: null, tax: 20 },
    { id: 3, platform: 'Airbnb', brut: null, box: null, tax: 20 },
  ]);
  assert.deepEqual(runHostStatementBrutMigration(db, { reversedTaxOf }).migrated, []);
});

test('rule 4 — a stay re-priced by the engine after the migration lands on the same price, schedule and tax as before, per mode', () => {
  const db = createDb();
  addPlatform(db, 'Airbnb', 'reversed');
  addPlatform(db, 'GitesDeFrance', 'remits');

  // Mode platform_reversed — Fraisse as it was typed: brut 829 (what Airbnb billed the guest, tax paid with the transfer inside).
  // The engine of 4.5.0 subtracted the 24,00 reversed tax: rent 725, finalPrice 805, tax 31,20, solde 829.
  const reversedBefore = { accommodation: 725, finalPrice: 805, tax: 31.2, balance: 829 };
  const reversed = storedDb([{ id: 1, platform: 'Airbnb', brut: 829, box: null, tax: 31.2, added: 7.2 }]);
  runHostStatementBrutMigration(reversed, { reversedTaxOf });
  const after = read(reversed, 1);
  const q = calculateReservationQuote({ ...FRAISSE, db, platformGrossAmount: after.brut, platformTouristTaxAmount: after.box });
  assert.deepEqual(
    { accommodation: q.accommodationAdjustedPrice, finalPrice: q.finalPrice, tax: q.touristTaxTotal, balance: q.balanceAmount },
    reversedBefore,
  );

  // Mode platform — Dausque as it was typed: brut 900 with the 36,00 the centrale kept inside it.
  // The engine of 4.5.0 took the box back out: rent 784, finalPrice 864, no tax in our books.
  const platformBefore = { accommodation: 784, finalPrice: 864, tax: 0, balance: 864 };
  const platform = storedDb([{ id: 1, platform: 'GitesDeFrance', brut: 900, box: 36, tax: 0 }]);
  runHostStatementBrutMigration(platform, { reversedTaxOf });
  const moved = read(platform, 1);
  const p = calculateReservationQuote({ ...DAUSQUE, offeredOptionIds: [], db, platformGrossAmount: moved.brut, platformTouristTaxAmount: moved.box });
  assert.deepEqual(
    { accommodation: p.accommodationAdjustedPrice, finalPrice: p.finalPrice, tax: p.touristTaxTotal, balance: p.balanceAmount },
    platformBefore,
  );
  db.close();
});
