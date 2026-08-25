/**
 * One-shot repair of the « solde = net » schedule shape
 * (specs/legacy-net-solde-schedule-repair.md).
 *
 * Since specs/platform-per-echeance-commission.md the échéances store the GROSS amounts — what the
 * guest pays the platform — and the operator-entered commission is tracked beside them; the owner
 * banks `échéance − commission`. Reservations written before that convention stored the NET in the
 * échéance while ALSO carrying the commission, so every reader that nets the commission out (the
 * fiche's « encaissé », the finance overview, `remainingToPay`) deducts it a second time.
 *
 * The accounting export already detects that shape and grosses the amounts back up
 * (`accountingModel.buildEntry`, `isLegacyNetSchedule`), which is why the books are right and the
 * fiche is not — on prod réservation #7 the journal debits the client 903 € (the real transfer) while
 * the fiche reads « encaissé 812 € ». This migration repairs the data instead of teaching every
 * reader the same heuristic: each bucket gets its own commission added back, the schedule then sums
 * to `finalPrice + taxe de séjour`, and the export's gross-up branch simply stops firing — the
 * journal it produces is unchanged, to the cent.
 *
 * Deliberately narrow. A row is only touched when the shape is unambiguous: a commission is entered,
 * the schedule is short, and adding the commission closes the gap exactly. Anything else — a plain
 * drift between the fiche total and its échéances, an operator-adjusted complement — is left alone.
 */

const TOLERANCE = 0.02;
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const nz = (value) => Number(value || 0);

/**
 * The shape test, mirrored from `accountingModel.buildEntry` so the two can never disagree: the
 * stored schedule is short of the stay total, and the entered commission is exactly what is missing.
 */
function isLegacyNetSchedule(row) {
  // Deliberately the export's own test — `platform !== 'direct'`, literally — and NOT
  // `isDirectChannel()`, which also files Lodgify under the direct channels. The books gross a
  // Lodgify row up exactly like any other platform row, so excluding it here would leave the fiche
  // wrong on precisely the reservations the export still repairs. Mirror the reader, not the
  // channel taxonomy.
  if (String(row.platform || 'direct').toLowerCase() === 'direct') return false;
  const commission = round2(Math.max(0, nz(row.acompteCommissionAmount)) + Math.max(0, nz(row.platformCommissionAmount)));
  if (commission <= 0) return false;
  const scheduled = round2(nz(row.depositAmount) + nz(row.balanceAmount)
    + nz(row.complementAmount) + nz(row.endOfStayComplementAmount));
  const expected = round2(nz(row.finalPrice) + nz(row.touristTaxTotal));
  return scheduled > 0
    && Math.abs(scheduled - expected) > TOLERANCE
    && Math.abs(round2(scheduled + commission) - expected) <= TOLERANCE;
}

/**
 * A commission can only be added back to a bucket that exists. A row carrying an acompte commission
 * with no acompte (or a solde commission with no solde) is degenerate data whose intent we cannot
 * read, so it is reported and left untouched rather than repaired into a bucket that collects a
 * commission and nothing else.
 */
function isRepairable(row) {
  if (row.complementAmountOverride != null) return false;
  if (Math.max(0, nz(row.acompteCommissionAmount)) > 0 && nz(row.depositAmount) <= 0) return false;
  if (Math.max(0, nz(row.platformCommissionAmount)) > 0 && nz(row.balanceAmount) <= 0) return false;
  return true;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {{ repaired: number, ids: number[], skipped: number[] }}
 */
function runLegacyNetSoldeRepair(db) {
  const rows = db.prepare(`
    SELECT id, platform, finalPrice, touristTaxTotal,
           depositAmount, balanceAmount, complementAmount, endOfStayComplementAmount,
           complementAmountOverride, acompteCommissionAmount, platformCommissionAmount
    FROM reservations
    WHERE kind IN ('reservation', 'cancelled')
      AND COALESCE(acompteCommissionAmount, 0) + COALESCE(platformCommissionAmount, 0) > 0
  `).all();

  const update = db.prepare('UPDATE reservations SET depositAmount = ?, balanceAmount = ? WHERE id = ?');
  const ids = [];
  const skipped = [];
  for (const row of rows) {
    if (!isLegacyNetSchedule(row)) continue;
    if (!isRepairable(row)) { skipped.push(Number(row.id)); continue; }
    const deposit = round2(nz(row.depositAmount) + Math.max(0, nz(row.acompteCommissionAmount)));
    const balance = round2(nz(row.balanceAmount) + Math.max(0, nz(row.platformCommissionAmount)));
    update.run(deposit, balance, row.id);
    ids.push(Number(row.id));
  }
  return { repaired: ids.length, ids, skipped };
}

module.exports = { runLegacyNetSoldeRepair, isLegacyNetSchedule, isRepairable };
