/**
 * One-shot migration: non-card lines move from a base quantity to a stored typed count
 * (specs/non-card-option-served-persons.md rules 14-16 and 19).
 *
 * Before, 3 people typed for a party of 5 were stored as `quantity = 0.6`, which billed 3.6 once the
 * party became 6. Such a line now carries `cardPersons = 3` (`cardNights` for a per-night option) and
 * `quantity = 1`. Only those two columns move: `billedUnits`, `unitPrice`, `totalPrice`, `inComplement`
 * and the acompte/solde contributions are never rewritten, so no amount changes.
 *
 * A line whose count is not a whole number has already drifted, and one above what the engine accepts
 * would be clamped at its next save, moving money silently. Both are left alone and listed for review.
 *
 * Idempotent: a migrated line has `quantity = 1` and is no longer matched.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{dryRun?: boolean}} [options]  dryRun returns the same report without writing.
 * @returns {{migrated: object[], skipped: object[]}}
 */

const { partyOf, nightsOf } = require('./typedCounts');

function runServedPersonsOptionMigration(db, { dryRun = false } = {}) {
  const columns = db.prepare('PRAGMA table_info(reservation_options)').all().map((c) => c.name);
  if (!columns.includes('cardPersons') || !columns.includes('cardNights')) return { migrated: [], skipped: [] };

  const rows = db.prepare(`
    SELECT ro.reservationId, ro.optionId, ro.priceType, ro.quantity, ro.billedUnits,
           r.startDate, r.endDate, r.adults, r.teens, r.children, p.maxGuests
      FROM reservation_options ro
      JOIN options o ON o.id = ro.optionId
      JOIN reservations r ON r.id = ro.reservationId
      LEFT JOIN properties p ON p.id = r.propertyId
     WHERE COALESCE(o.showsPlanningCard, 0) = 0
       AND COALESCE(o.isCancellationInsurance, 0) = 0
       AND ro.priceType IN ('per_person', 'per_person_per_night', 'per_night')
       AND ro.quantity <> 1
  `).all();

  const setPersons = db.prepare('UPDATE reservation_options SET cardPersons = ?, quantity = 1 WHERE reservationId = ? AND optionId = ?');
  const setNights = db.prepare('UPDATE reservation_options SET cardNights = ?, quantity = 1 WHERE reservationId = ? AND optionId = ?');
  const migrated = [];
  const skipped = [];

  for (const row of rows) {
    const nights = nightsOf(row);
    const party = partyOf(row);
    const perNight = row.priceType === 'per_night';
    const count = row.priceType === 'per_person_per_night' && nights > 0
      ? Number(row.billedUnits) / nights
      : Number(row.billedUnits);
    const entry = {
      reservationId: row.reservationId, optionId: row.optionId, priceType: row.priceType,
      quantity: row.quantity, billedUnits: row.billedUnits, count,
    };
    if (!Number.isInteger(count) || count <= 0) { skipped.push({ ...entry, reason: 'not-a-whole-number' }); continue; }
    if (!perNight && count > Math.max(party, Number(row.maxGuests) || 0)) { skipped.push({ ...entry, reason: 'above-the-ceiling' }); continue; }
    const follows = perNight ? count === nights : count === party;
    const stored = follows ? null : count;
    if (!dryRun) (perNight ? setNights : setPersons).run(stored, row.reservationId, row.optionId);
    migrated.push({ ...entry, stored });
  }
  return { migrated, skipped };
}

module.exports = { runServedPersonsOptionMigration };
