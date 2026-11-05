/**
 * When a tourist tax stops moving, and how to recover the base of one that already has.
 *
 * specs/tourist-tax-matches-the-office-calculation.md rules 10-14.
 *
 * The tax is live for as long as the guest has not paid it: the brut of a platform booking often
 * lands after the reservation does, and the amount must be allowed to follow it right up to the
 * moment it is charged. Once the instalment carrying it is collected — or the line is ticked
 * « Déclarée » — the amount is what the guest paid and what the commune was told, so it is pinned
 * for good, along with the base and the occupant count that produced it.
 *
 * That replaces the old « past stay » freeze (specs/tourist-tax-freeze-past-with-refresh.md rule 1):
 * a stay whose last night has gone by is not necessarily a stay anyone declared, and pinning it
 * there is what stopped an uncollected booking from ever being corrected.
 *
 * One home for the decision, so the save path, the « Suivi taxe de séjour » declaration and the
 * migration can never freeze on different grounds. The db is only ever read, and only to resolve
 * which instalment carries the tax.
 */

const { todayIso } = require('./localDate');

// Which instalment carries the tax, in SQL — the three-way platform routing of
// specs/per-platform-tourist-tax-three-way.md. Answered without pricing the stay, because the freeze
// has to be decided BEFORE the engine runs (the engine needs to know whether to freeze) and because
// the backfill cannot afford to price several thousand reservations for one boolean per row.
// `collectsTouristTax = 0` is case 3 — we collect at arrival, in the complement; everything else
// rides the balance.
const TAX_ON_ARRIVAL_SQL = `(
  r.touristTaxInComplement = 1
  OR EXISTS (
    SELECT 1 FROM platforms pl
    WHERE lower(pl.name) = lower(r.platform) AND pl.collectsTouristTax = 0
  )
  OR EXISTS (
    SELECT 1 FROM ical_sources s JOIN platforms pl ON lower(pl.name) = lower(s.platformLabel)
    WHERE (lower(s.platformKey) = lower(r.platform) OR lower(s.platformLabel) = lower(r.platform))
      AND pl.collectsTouristTax = 0
  )
)`;

// Memoised per database handle: the answer cannot change while the process lives (the columns are
// added by the startup migration, before anything here runs).
const freezeColumnsByDb = new WeakMap();
function hasFreezeColumns(database) {
  if (freezeColumnsByDb.has(database)) return freezeColumnsByDb.get(database);
  let present = false;
  try {
    present = database.prepare("PRAGMA table_info(reservations)").all()
      .some((column) => column.name === 'touristTaxFrozenAt');
  } catch {
    present = false;
  }
  freezeColumnsByDb.set(database, present);
  return present;
}

/**
 * Does this reservation's tax ride the arrival complement rather than the balance?
 * Guarded for the minimal test schemas that have no `platforms` / `ical_sources` table.
 */
function taxRidesTheComplement(db, reservation) {
  if (!reservation) return false;
  if (Number(reservation.touristTaxInComplement || 0)) return true;
  try {
    const row = db.prepare(`SELECT ${TAX_ON_ARRIVAL_SQL} AS onArrival FROM reservations r WHERE r.id = ?`)
      .get(reservation.id);
    return Boolean(row && Number(row.onArrival));
  } catch {
    return false;
  }
}

/**
 * Would a stay on this platform carry its tax on the complement? The stay's own switch left aside, read
 * through the same routing as the stored rows. A platform that is not a text or is not known: no.
 */
function platformTakesTaxOnArrival(db, platform) {
  if (typeof platform !== 'string' || !platform) return false;
  try {
    const row = db.prepare(`SELECT ${TAX_ON_ARRIVAL_SQL} AS onArrival FROM (SELECT 0 AS touristTaxInComplement, ? AS platform) r`).get(platform);
    return Boolean(row && Number(row.onArrival));
  } catch {
    return false;
  }
}

/**
 * Where a stay's installment plan stands: none, all paid, and whether a paid installment holds a share of
 * the tax. A paid installment's share is the one frozen on it (`paidSplit`), an older row without one
 * reads it from the plan. A minimal test schema without the table holds no plan.
 */
function installmentPlanState(db, reservationId) {
  const none = { hasPlan: false, allPaid: false, paidTaxShare: false };
  let plan;
  try {
    plan = db.prepare('SELECT id, paid, paidSplit FROM reservation_installments WHERE reservationId = ?').all(reservationId);
  } catch {
    return none;
  }
  if (plan.length === 0) return none;
  // Required here: installmentPaidSplit reads TAX_ON_ARRIVAL_SQL from this module.
  const { computeInstallmentPaidSplit, parsePaidSplit } = require('./installmentPaidSplit');
  const paid = plan.filter((installment) => Number(installment.paid) === 1);
  return {
    hasPlan: true,
    allPaid: paid.length === plan.length,
    paidTaxShare: paid.some((installment) => {
      const split = parsePaidSplit(installment.paidSplit) || computeInstallmentPaidSplit(db, installment.id);
      return Boolean(split) && split.taxCents > 0;
    }),
  };
}

/** Is the bucket that carries the tax on a stay without a plan collected? The page's gate, in JS. */
function taxBucketPaid(db, reservation) {
  return Boolean(taxRidesTheComplement(db, reservation)
    ? Number(reservation.complementPaid || 0)
    : Number(reservation.balancePaid || 0));
}

/**
 * Pinned by the fiche's own history: a stamp, a tick, or the bucket carrying the tax collected. The
 * VAT regime switch reads this one: a stay with a plan is reported for its plan before anything else
 * (specs/vat-optional-mode.md rule 27), so its paid installments must not hide it as merely frozen.
 */
function isTouristTaxFrozenAsidePlan(db, reservation) {
  if (!reservation) return false;
  if (!hasFreezeColumns(db)) return false;
  if (reservation.touristTaxFrozenAt) return true;
  if (reservation.touristTaxDeclaredAt) return true;
  return taxBucketPaid(db, reservation);
}

/**
 * Is this reservation's tax pinned? Either the migration or an earlier save stamped it (rule 13),
 * or the event that pins it has since happened: the instalment carrying the tax is collected, or the
 * line was ticked « Déclarée » (rules 10-11), or a plan is fully paid or a paid installment holds a
 * share of the tax (rule 19, D17).
 *
 * Read live from the payment flags rather than only from the stamp, because a tax can be collected
 * through the arrival SAS or the payments page without the fiche ever being saved again — and from
 * that moment the guest has paid, so the amount must not move.
 */
function isTouristTaxFrozen(db, reservation) {
  if (isTouristTaxFrozenAsidePlan(db, reservation)) return true;
  if (!reservation || !hasFreezeColumns(db)) return false;
  const plan = installmentPlanState(db, reservation.id);
  return plan.allPaid || plan.paidTaxShare;
}

/**
 * May « Déclarée » be ticked (specs/tourist-tax-declared-checkbox.md rule 8, D16)? The stay is paid and
 * its end date is behind us: today > endDate. Paid is the page's own gate on a stay without a plan, every
 * installment on a plan, and the complement too when the tax rides it. Today is the server's local day, Europe/Paris (utils/localDate).
 */
function isTouristTaxDeclarable(db, reservation, today = todayIso()) {
  if (!reservation) return false;
  const endDate = String(reservation.endDate || '').slice(0, 10);
  if (!endDate || endDate >= today) return false;
  const plan = installmentPlanState(db, reservation.id);
  if (!plan.hasPlan) return taxBucketPaid(db, reservation);
  return plan.allPaid && (!taxRidesTheComplement(db, reservation) || Boolean(Number(reservation.complementPaid || 0)));
}

/**
 * Why the tax cannot be switched to the complement (specs/force-item-to-complement.md rule 20): the
 * bucket holding it is collected, and moving it would rewrite a booked entry and ask the tax twice.
 * Null while the switch can go on, and for a stay whose tax already rides the complement.
 */
function taxInComplementLockedReason(db, reservation) {
  if (!reservation || reservation.kind === 'devis') return null;
  if (taxRidesTheComplement(db, reservation)) return null;
  if (installmentPlanState(db, reservation.id).paidTaxShare) return 'collected-on-installment';
  if (Number(reservation.balancePaid || 0)) {
    const contrib = reservation.touristTaxSoldeContribTtc;
    // No contribs on an older solde: the tax rode on it (specs/tourist-tax-on-solde.md).
    if (contrib == null ? Number(reservation.touristTaxTotal || 0) > 0 : Number(contrib) > 0) return 'collected-on-solde';
  }
  if (Number(reservation.depositPaid || 0) && Number(reservation.touristTaxAcompteContribTtc || 0) > 0) return 'collected-on-acompte';
  return null;
}

/**
 * Store, beside the amount a save just wrote, the base and divisor that produced it (rule 12) — and
 * stamp the freeze the moment it becomes due (rules 10-11).
 *
 * The three descriptive columns are refreshed on EVERY save, not only on the one that freezes: the
 * tax the guest will be asked for is the one of the last save before collection, so those are
 * exactly the figures that must survive it. Once frozen the engine returns the pinned values, so
 * re-writing them is a no-op — and `touristTaxFrozenAt` is COALESCEd, never moved.
 *
 * Called at the end of create and update, inside their transaction. A stay whose tax is offered by
 * the platform stores a 0 base and never freezes: there is nothing to declare.
 */
function writeTouristTaxSnapshot(database, reservationId, quote) {
  // A minimal test schema — and only that — lacks the freeze columns. Checked rather than caught, so
  // a genuine SQL failure in production still surfaces instead of being swallowed as « no columns ».
  if (!hasFreezeColumns(database)) return { frozen: false };
  const stored = database.prepare(`
    SELECT id, touristTaxInComplement, touristTaxDeclaredAt, touristTaxFrozenAt,
           balancePaid, complementPaid
    FROM reservations WHERE id = ?
  `).get(reservationId);
  if (!stored) return { frozen: false };

  const freezeDue = !quote.touristTaxOfferedByPlatform && isTouristTaxFrozen(database, stored);
  database.prepare(`
    UPDATE reservations
    SET touristTaxFrozenBaseHt = ?,
        touristTaxFrozenOccupants = ?,
        touristTaxFrozenUnitAmount = ?,
        touristTaxFrozenAt = COALESCE(touristTaxFrozenAt, ?)
    WHERE id = ?
  `).run(
    Number(quote.touristTaxBaseHt || 0),
    Number(quote.touristTaxOccupantsCount || 0),
    Number(quote.touristTaxUnitAmount || 0),
    freezeDue ? (stored.touristTaxFrozenAt || new Date().toISOString().replace('T', ' ').slice(0, 19)) : null,
    reservationId,
  );
  return { frozen: freezeDue };
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Rebuild the base a stored amount was computed on, by inverting the engine's arithmetic (rule 14).
 *
 * Used once, by the migration, for every reservation that predates the frozen columns: without it a
 * frozen stay would keep showing a base recomputed under today's rules, which is the very defect
 * this spec exists to remove.
 *
 * Returns `null` — and the caller leaves the columns NULL — whenever the inversion cannot apply:
 * a per-night property (no price enters its tax), a zero amount, no adults, no nights, no occupants,
 * or a commune rate of 0. Measured on the 13 Lodge stays carrying a tax in production: 13/13 return
 * a base that reproduces the stored amount exactly.
 */
function reconstructFrozenBase({
  touristTaxTotal,
  nights,
  adults,
  occupants,
  touristTaxPercentage,
  touristTaxDepartmentPercentage,
}) {
  const total = Number(touristTaxTotal || 0);
  const nightsCount = Number(nights || 0);
  const adultsCount = Number(adults || 0);
  const occupantsCount = Number(occupants || 0);
  const communePercentage = Number(touristTaxPercentage || 0);
  const departmentPercentage = Number(touristTaxDepartmentPercentage || 0);

  if (!(total > 0) || !(nightsCount > 0) || !(adultsCount > 0)
    || !(occupantsCount > 0) || !(communePercentage > 0)) {
    return null;
  }

  const unitAmount = total / (nightsCount * adultsCount);
  const municipalUnitAmount = unitAmount / (1 + (departmentPercentage / 100));
  const perOccupantNightPriceHt = municipalUnitAmount / (communePercentage / 100);
  const baseHt = round2(perOccupantNightPriceHt * occupantsCount * nightsCount);

  return {
    touristTaxFrozenBaseHt: baseHt,
    touristTaxFrozenOccupants: occupantsCount,
    touristTaxFrozenUnitAmount: round2(unitAmount),
  };
}

module.exports = {
  TAX_ON_ARRIVAL_SQL,
  taxRidesTheComplement,
  platformTakesTaxOnArrival,
  isTouristTaxFrozen,
  isTouristTaxFrozenAsidePlan,
  isTouristTaxDeclarable,
  taxInComplementLockedReason,
  writeTouristTaxSnapshot,
  reconstructFrozenBase,
};
