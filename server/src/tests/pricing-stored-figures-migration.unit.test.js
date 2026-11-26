// specs/pricing/pricing-components.md §3 rule 8 and §5; specs/hosting/self-update-and-releases.md rule 31 — the stored extra guests and tax: two
// nullable columns added once, a backfill that writes for each live stay what a sale on it computes today (nothing else of the row,
// so no figure moves), runs once, writes the same records when forced again, leaves a stay whose sale is refused to the units, and
// the previous release's save on the migrated table leaves records the next sale no longer reads.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const {
  runPricingStoredFiguresMigration, backfillSaleFigures, backfillSaleFiguresOnce, BACKFILL_MARKER,
} = require('../utils/pricingStoredFiguresMigration');
const { storedSaleFiguresOfRow } = require('../utils/pricing/storedSaleFigures');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const PROPERTY = 9621;
db.prepare(`INSERT INTO properties (id, name, maxGuests, depositEnabled, touristTaxMode, touristTaxPerDayPerPerson, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit)
  VALUES (?, 'Rejeu', 8, 0, 'per_day_per_person', 2, 2, 30, 'per_stay')`).run(PROPERTY);
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9621, 'Camille', 'Rejeu')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, minNights) VALUES (?, 'Standard', 90, 1)").run(PROPERTY);
const wine = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Panier vin', 25, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(PROPERTY, wine);

const START = addDaysToIsoDate(todayIso(), 30);
function stay({ kind = 'reservation', adults = 3 } = {}) {
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, touristTaxRate, touristTaxTotal, kind, checkInTime, balanceDueDate)
    VALUES (?, 9621, ?, ?, 'direct', ?, 270, 300, 2, ?, ?, '15:00', ?)`).run(PROPERTY, START, addDaysToIsoDate(START, 3), adults, adults * 6, kind, START).lastInsertRowid);
  for (let n = 0; n < 3; n += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Standard', 'fixed', 90)").run(id, addDaysToIsoDate(START, n));
  }
  return id;
}
const recordsOf = (id) => db.prepare('SELECT storedExtraGuests, storedTouristTax FROM reservations WHERE id = ?').get(id);
const moneyOf = (id) => db.prepare('SELECT totalPrice, touristTaxTotal, finalPrice, depositAmount, balanceAmount, complementAmount, extraGuestComplementSurcharge FROM reservations WHERE id = ?').get(id);

test('F1: the two columns are added once, nullable, and a second run adds nothing', () => {
  const old = new Database(':memory:');
  old.exec("CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', touristTaxTotal REAL)");
  old.prepare('INSERT INTO reservations (id, touristTaxTotal) VALUES (1, 12)').run();
  assert.equal(runPricingStoredFiguresMigration(old), 2);
  assert.equal(runPricingStoredFiguresMigration(old), 0);
  assert.deepEqual(old.prepare('SELECT storedExtraGuests, storedTouristTax, touristTaxTotal FROM reservations').get(), { storedExtraGuests: null, storedTouristTax: null, touristTaxTotal: 12 });
  const columns = old.prepare('PRAGMA table_info(reservations)').all().filter((c) => c.name.startsWith('stored'));
  assert.deepEqual(columns.map((c) => [c.name, c.type, c.notnull, c.dflt_value]), [['storedExtraGuests', 'TEXT', 0, null], ['storedTouristTax', 'TEXT', 0, null]]);
});

test('B1: the backfill writes the records of each live stay and nothing else; a devis keeps none', () => {
  const live = stay();
  const devis = stay({ kind: 'devis' });
  const before = moneyOf(live);
  const { written } = backfillSaleFigures(db);
  assert.ok(written.includes(live));
  assert.equal(written.includes(devis), false);
  assert.deepEqual(moneyOf(live), before, 'no money column of the row is written');
  const stored = storedSaleFiguresOfRow({ ...recordsOf(live), touristTaxTotal: before.touristTaxTotal });
  assert.deepEqual([stored.extraGuests.figures.extraGuestSurcharge, stored.touristTax.figures.touristTaxTotal], [30, 18]);
  assert.deepEqual(recordsOf(devis), { storedExtraGuests: null, storedTouristTax: null });
});

test('B1: runs once; forced again it writes the very same records (re-runnable, deterministic)', () => {
  const id = stay();
  db.prepare('DELETE FROM migrations WHERE name = ?').run(BACKFILL_MARKER);
  const first = backfillSaleFiguresOnce(db);
  assert.ok(first.written.includes(id));
  const records = db.prepare('SELECT id, storedExtraGuests, storedTouristTax FROM reservations ORDER BY id').all();
  assert.deepEqual(backfillSaleFiguresOnce(db), { written: [], refused: [] }, 'the marker stops a second boot');
  const forced = backfillSaleFiguresOnce(db, { force: true });
  assert.deepEqual(forced.written, first.written.concat(records.filter((r) => !first.written.includes(r.id) && r.storedTouristTax).map((r) => r.id)).sort((a, b) => a - b));
  assert.deepEqual(db.prepare('SELECT id, storedExtraGuests, storedTouristTax FROM reservations ORDER BY id').all(), records);
});

test('B1: a stay whose sale is refused keeps no record (its sales are refused the same way)', () => {
  const id = stay();
  db.pragma('foreign_keys = OFF');
  db.prepare('UPDATE reservations SET propertyId = 999999 WHERE id = ?').run(id);
  try {
    const { written, refused } = backfillSaleFigures(db);
    assert.equal(written.includes(id), false);
    assert.ok(refused.includes(id));
    assert.deepEqual(recordsOf(id), { storedExtraGuests: null, storedTouristTax: null });
  } finally {
    db.prepare('UPDATE reservations SET propertyId = ? WHERE id = ?').run(PROPERTY, id);
    db.pragma('foreign_keys = ON');
  }
});

test('rollback (self-update rule 31): the previous release\'s save rewrites the party and the tax; the next sale runs the units', () => {
  const id = stay();
  backfillSaleFigures(db);
  // The previous release's fiche save: the row's own columns, the two records untouched (it knows nothing of them).
  db.prepare('UPDATE reservations SET adults = ?, touristTaxTotal = ?, finalPrice = ? WHERE id = ?').run(4, 24, 330, id);
  assert.equal(storedSaleFiguresOfRow(db.prepare('SELECT * FROM reservations WHERE id = ?').get(id)).touristTax, null, 'the tax record no longer states the row\'s tax');
  const sold = extraSale.sell(id, [{ articleRef: `option:${wine}`, quantity: 1 }], { source: 'fiche' });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  const row = moneyOf(id);
  assert.deepEqual([row.touristTaxTotal, row.finalPrice], [24, 355], 'four adults priced by the units: 60 € of extra guests, 24 € of tax, the wine');
});
