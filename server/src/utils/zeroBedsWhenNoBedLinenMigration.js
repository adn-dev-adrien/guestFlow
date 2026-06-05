/**
 * One-shot data migration: bed counts on a reservation are only meaningful when the
 * reservation actually carries the bed-linen contract. Zero
 * `reservations.singleBeds / doubleBeds / babyBeds` for every reservation that has no
 * `countsAsBedLinen = 1` option in its `reservation_options` AND whose property has no
 * `countsAsBedLinen = 1` option in `property_option_defaults`.
 *
 * Spec: specs/bed-config-in-linen-card.md §5.
 *
 * Rationale: pre-migration, the operator could enter bed counts on a reservation without
 * ticking the bed-linen option — the values then sat in the DB but contributed zero to the
 * laundry aggregation (the SQL in `models/laundryModel.js` requires a flagged option to count).
 * After this migration the DB state matches what the new UI invariant enforces going forward:
 * non-zero bed counts only exist on reservations that include bed linen.
 *
 * The property-default fallback is honoured to mirror the laundry aggregator's UNION ALL
 * source 2 — a reservation that doesn't have the explicit option but whose property declares
 * bed linen as a default IS still considered as having bed linen.
 *
 * Devis (`kind = 'devis'`) are skipped: they don't feed the laundry and they don't carry the
 * same form invariant (the devis page has its own surface). Only `kind = 'reservation'` is
 * touched.
 *
 * Gated by the caller via `migrations.zero_beds_when_no_bed_linen_option_v1`. This function
 * does NOT check or insert into the `migrations` table — `database.js` owns idempotency.
 * The caller wraps the call in `db.transaction()` so a partial run rolls back cleanly.
 */

function runZeroBedsWhenNoBedLinenMigration(database) {
  const result = database.prepare(`
    UPDATE reservations
       SET singleBeds = 0, doubleBeds = 0, babyBeds = 0
     WHERE kind = 'reservation'
       AND ( COALESCE(singleBeds, 0) > 0
          OR COALESCE(doubleBeds, 0) > 0
          OR COALESCE(babyBeds,   0) > 0 )
       AND id NOT IN (
         SELECT DISTINCT ro.reservationId
           FROM reservation_options ro
           JOIN options o ON o.id = ro.optionId
          WHERE o.countsAsBedLinen = 1
       )
       AND ( propertyId IS NULL OR propertyId NOT IN (
         SELECT DISTINCT pod.propertyId
           FROM property_option_defaults pod
           JOIN options o ON o.id = pod.optionId
          WHERE o.countsAsBedLinen = 1
       ))
  `).run();
  return { zeroedCount: result.changes };
}

module.exports = { runZeroBedsWhenNoBedLinenMigration };
