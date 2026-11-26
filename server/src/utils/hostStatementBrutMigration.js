/**
 * One pass over the stored brut of every platform stay (specs/platform-host-statement-and-commission-vat.md rule 4).
 *
 * The brut used to be the guest-paid total (tourist tax inside it); it is now the host amount of the platform's statement,
 * which never holds the tax. So that every stored price stays to the cent, the tax a row's brut contained comes out of it:
 *   - mode `platform` with a filled box → `brut := brut − box` (the box stays: the tax the platform kept);
 *   - mode `platform_reversed` → `brut := brut − T` and `box := T`, T the reversed tax the engine subtracted on that row
 *     (`reversedTaxOf(row)`: the engine's own figure, frozen stays included), so the tax gap is 0 and `finalPrice`, the schedule and
 *     the tax do not move;
 *     (a stay whose tax is frozen at 0 is left untouched, its box too: the box of such a stay is data the reports read);
 *   - `platformOptionsAmount` stays NULL (no check on history).
 * Fees inside a historical brut stay: no retroactivity.
 */
const { isNamedChannel } = require('./saleChannel');
const { roundMoney } = require('./pricing/money');
const { touristTaxModeOf } = require('./platformTaxMode');

function runHostStatementBrutMigration(db, { reversedTaxOf, frozenAtZero = () => false }) {
  const rows = db.prepare(`
    SELECT *
      FROM reservations
     WHERE platformGrossAmount IS NOT NULL AND platform IS NOT NULL
  `).all().filter((row) => isNamedChannel(row.platform));
  const update = db.prepare('UPDATE reservations SET platformGrossAmount = ?, platformTouristTaxAmount = ? WHERE id = ?');
  const touched = [];
  for (const row of rows) {
    const mode = touristTaxModeOf(db, row.platform);
    let brut = Number(row.platformGrossAmount);
    let box = row.platformTouristTaxAmount == null ? null : Number(row.platformTouristTaxAmount);
    if (mode === 'platform' && box != null && box > 0) {
      brut = roundMoney(Math.max(0, brut - box));
    } else if (mode === 'platform_reversed') {
      // A tax frozen at 0 was priced under another mode: the stay is left as it is, box included — the engine reads no gap on it (rule 9).
      if (frozenAtZero(row)) continue;
      const tax = Math.max(0, roundMoney(Number(reversedTaxOf(row)) || 0));
      brut = roundMoney(Math.max(0, brut - tax));
      box = tax > 0 ? tax : null;
    } else continue;
    if (brut === Number(row.platformGrossAmount) && box === (row.platformTouristTaxAmount == null ? null : Number(row.platformTouristTaxAmount))) continue;
    update.run(brut, box, row.id);
    touched.push(row.id);
  }
  return { migrated: touched };
}

/** The engine's reversed tax of a stored stay: replays it through the tax slice, frozen tax included. Required lazily — the engine opens the database. */
function reversedTaxOfStoredStay(db) {
  const { touristTaxFigureOfStoredReservation } = require('./storedReservationQuote');
  // The box is blanked: the old engine ignored it in reversed mode, and the tax base now reads it (a percentage tax would move).
  return (row) => (touristTaxFigureOfStoredReservation(db, { ...row, platformTouristTaxAmount: null }) || {}).reversedTouristTaxInBrut || 0;
}

/** A stay whose tax is frozen at 0 (priced while its platform kept the tax). Required lazily — it reads the schedule. */
function frozenAtZeroOfStoredStay(db) {
  const { isTouristTaxFrozen } = require('./touristTaxFreeze');
  return (row) => isTouristTaxFrozen(db, row) && roundMoney(Number(row.touristTaxTotal || 0)) === 0;
}

module.exports = { runHostStatementBrutMigration, reversedTaxOfStoredStay, frozenAtZeroOfStoredStay };
