/**
 * One-shot backfill: apply each property's DEFAULT options to its existing reservations.
 *
 * specs/property-default-option-applicability.md §5. A property default (`property_option_defaults`)
 * means "auto-add this option on every reservation of that property". New reservations already get
 * it (devis/manual via the payload merge, iCal via its own insert), but reservations created before
 * the default existed (or before the iCal-default insert shipped) lack the row — so the in-card
 * bed-config editor never shows on them (the card is gated on an attached bed-linen option).
 *
 * This inserts the missing rows onto existing `kind='reservation'` reservations, mirroring the
 * iCal-import default insert: `quantity 1, unitPrice 0, billedUnits 0, priceType` from the option,
 * `totalPrice 0`, `offered` = the configured flag. Pricing stays 0 at backfill time — the engine
 * recomputes every line from `optionId + quantity` the next time the operator saves the reservation
 * (and `getApplicableOptions` now keeps a property-default option, so it persists).
 *
 * Idempotent: the `NOT EXISTS` guard skips reservations that already carry the option, so re-running
 * inserts nothing. Pure (takes the db handle); the caller wraps it in a transaction + migration flag.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ insertedCount: number }}
 */
function runBackfillPropertyDefaultOptionsMigration(db) {
  let defaults;
  try {
    defaults = db.prepare(`
      SELECT d.propertyId, d.optionId, d.offered, o.priceType
      FROM property_option_defaults d
      JOIN options o ON o.id = d.optionId
    `).all();
  } catch {
    // Minimal schema without the defaults/options tables — nothing to backfill.
    return { insertedCount: 0 };
  }

  const insert = db.prepare(`
    INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
    SELECT r.id, @optionId, 1, 0, 0, @priceType, 0, @offered
    FROM reservations r
    WHERE r.propertyId = @propertyId
      AND COALESCE(r.kind, 'reservation') = 'reservation'
      AND NOT EXISTS (
        SELECT 1 FROM reservation_options ro WHERE ro.reservationId = r.id AND ro.optionId = @optionId
      )
  `);

  let insertedCount = 0;
  for (const d of defaults) {
    const info = insert.run({
      optionId: Number(d.optionId),
      priceType: d.priceType || 'per_stay',
      offered: d.offered ? 1 : 0,
      propertyId: Number(d.propertyId),
    });
    insertedCount += Number(info.changes) || 0;
  }
  return { insertedCount };
}

module.exports = { runBackfillPropertyDefaultOptionsMigration };
