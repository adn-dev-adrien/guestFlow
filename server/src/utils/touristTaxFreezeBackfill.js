/**
 * Freeze, once, every tourist tax the guest has already paid or the operator has already declared.
 *
 * specs/tourist-tax-matches-the-office-calculation.md rule 13.
 *
 * The spec changes the base (the platform brut derives it again), the divisor (babies stop counting)
 * and the moment the amount stops moving. Applied blindly, it would rewrite stays that are settled
 * and, for some, already remitted to the commune. So this pass draws the line: what the guest has
 * paid keeps its amount forever, everything still to be collected re-prices under the new rules and
 * is billed correctly.
 *
 * The base is recovered by inverting the engine's arithmetic (rule 14) rather than by re-running the
 * engine: re-running it would produce today's base, which is precisely the number that no longer
 * matches the frozen amount. Where the inversion cannot apply, the columns stay NULL and the screens
 * fall back to what they show today.
 *
 * ONE-SHOT — guarded by the `migrations` table. It only ever writes the four `touristTaxFrozen*`
 * columns, and only on rows where `touristTaxFrozenAt` is still NULL, so a re-run is a no-op.
 */

const { TAX_ON_ARRIVAL_SQL, reconstructFrozenBase } = require('./touristTaxFreeze');

function runTouristTaxFreezeBackfill(db, { frozenAt } = {}) {
  const stamp = frozenAt || new Date().toISOString().replace('T', ' ').slice(0, 19);

  const rows = db.prepare(`
    SELECT
      r.id,
      r.adults, r.children, r.teens, r.babies,
      COALESCE(r.touristTaxTotal, 0) AS touristTaxTotal,
      r.touristTaxDeclaredAt,
      COALESCE(r.balancePaid, 0) AS balancePaid,
      COALESCE(r.complementPaid, 0) AS complementPaid,
      ${TAX_ON_ARRIVAL_SQL} AS taxOnArrival,
      MAX(0, CAST(JULIANDAY(r.endDate) - JULIANDAY(r.startDate) AS INTEGER)) AS nightsCount,
      COALESCE(p.touristTaxPercentage, 0) AS touristTaxPercentage,
      COALESCE(p.touristTaxDepartmentPercentage, 0) AS touristTaxDepartmentPercentage,
      COALESCE(p.touristTaxMode, 'per_day_per_person') AS touristTaxMode
    FROM reservations r
    JOIN properties p ON p.id = r.propertyId
    WHERE r.touristTaxFrozenAt IS NULL
  `).all();

  const update = db.prepare(`
    UPDATE reservations
    SET touristTaxFrozenAt = ?,
        touristTaxFrozenBaseHt = ?,
        touristTaxFrozenOccupants = ?,
        touristTaxFrozenUnitAmount = ?
    WHERE id = ?
  `);

  const frozen = [];
  const leftLive = [];
  for (const row of rows) {
    const collected = Number(row.taxOnArrival) ? Number(row.complementPaid) : Number(row.balancePaid);
    if (!collected && !row.touristTaxDeclaredAt) {
      leftLive.push(row.id);
      continue;
    }
    // The divisor in force when the amount was computed — babies INCLUDED, since rule 8 only applies
    // from here on. Reconstructing with the new divisor would rebuild a base that does not reproduce
    // the stored amount.
    const occupants = Number(row.adults || 0) + Number(row.children || 0)
      + Number(row.teens || 0) + Number(row.babies || 0);
    const rebuilt = String(row.touristTaxMode || '').startsWith('percentage')
      ? reconstructFrozenBase({
        touristTaxTotal: row.touristTaxTotal,
        nights: row.nightsCount,
        adults: row.adults,
        occupants,
        touristTaxPercentage: row.touristTaxPercentage,
        touristTaxDepartmentPercentage: row.touristTaxDepartmentPercentage,
      })
      : null;
    update.run(
      stamp,
      rebuilt ? rebuilt.touristTaxFrozenBaseHt : null,
      rebuilt ? rebuilt.touristTaxFrozenOccupants : null,
      rebuilt ? rebuilt.touristTaxFrozenUnitAmount : null,
      row.id,
    );
    frozen.push(row.id);
  }

  return { frozen, leftLive };
}

module.exports = { runTouristTaxFreezeBackfill };
