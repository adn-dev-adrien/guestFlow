/**
 * One-shot migration: public devis lines whose quantity meant SÉANCES now mean PORTIONS
 * (specs/site-meal-portions.md rule 11).
 *
 * Before this change a website visitor's « 2 » on a per-person card option billed 2 × persons; the
 * stored line therefore carries `quantity = 2` and `billedUnits = 2 × persons`. Now the engine bills
 * the quantity as it stands, and it is REPLAYED on a stored devis every time a PDF is printed or a
 * payment link is resolved (`paymentsController.resolveAmountCents`), where the snapshot only locks
 * the unit price. Left alone, those devis would silently re-price DOWN — a guest would be charged
 * less than the quote they accepted.
 *
 * Setting `quantity = billedUnits` makes the replay reproduce exactly the billed units it already
 * has. Nothing else moves: `billedUnits`, `unitPrice`, `totalPrice` and the devis totals are
 * untouched. Idempotent by construction (`quantity = billedUnits` is a fixed point), and scoped to
 * the only rows that can carry the old meaning: public devis, per-person card options, unscheduled.
 */

function runMealPortionQuantitiesMigration(database) {
  let cols;
  try {
    cols = database.prepare('PRAGMA table_info(reservation_options)').all().map((c) => c.name);
  } catch {
    return { action: 'skipped-schema', changed: 0 };
  }
  if (!cols.includes('billedUnits') || !cols.includes('cardOccurrences')) {
    return { action: 'skipped-schema', changed: 0 };
  }

  const info = database.prepare(`
    UPDATE reservation_options
       SET quantity = billedUnits
     WHERE cardOccurrences IS NULL
       AND billedUnits IS NOT NULL
       AND quantity <> billedUnits
       AND optionId IN (
         SELECT id FROM options
          WHERE showsPlanningCard = 1
            AND isCancellationInsurance = 0
            AND priceType LIKE 'per_person%'
       )
       AND reservationId IN (
         SELECT id FROM reservations WHERE kind = 'devis' AND requestOrigin = 'public'
       )
  `).run();

  return { action: 'migrated', changed: info.changes };
}

module.exports = { runMealPortionQuantitiesMigration };
