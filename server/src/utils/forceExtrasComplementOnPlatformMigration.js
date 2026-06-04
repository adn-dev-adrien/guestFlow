/**
 * One-shot data migration: force `inComplement = 1` on every extra line
 * (`reservation_options`, `reservation_custom_options`, `reservation_resources`)
 * attached to a non-direct platform reservation, mirroring the runtime rule
 * enforced by `reservationsModel.replace{Options,CustomOptions,Resources}` after
 * the same spec lands.
 *
 * Spec: specs/force-extras-complement-on-platform.md §3 rule 6.
 *
 * Gated by the caller via `migrations.force_extras_complement_on_platform_v1`.
 * This function does NOT check or insert into the `migrations` table — it just
 * runs the work. The boot path in `database.js` owns the idempotency record.
 *
 * The function is wrapped in `db.transaction()` by the caller so a partial run
 * rolls back cleanly on error.
 *
 * Idempotency is also enforced by the WHERE clause itself: rows with
 * `inComplement = 1` are skipped. A second invocation reports 0 affected.
 *
 * Side-effect: if a forced row had a previously-captured `acompteContribTtc`
 * (rare on platforms post-PR #116, but possible on legacy data), a one-line
 * warning is emitted per affected reservation so the operator can spot-check
 * the next monthly export.
 */

// The 3 tables that carry per-line extras + the (inComplement, contribs) triplet.
const EXTRAS_TABLES = ['reservation_options', 'reservation_custom_options', 'reservation_resources'];

function runForceExtrasComplementOnPlatform(database) {
  const candidateReservations = database.prepare(`
    SELECT id FROM reservations
     WHERE platform IS NOT NULL
       AND platform != ''
       AND LOWER(platform) != 'direct'
  `).all();

  if (candidateReservations.length === 0) {
    return { affectedReservations: 0, affectedLines: 0 };
  }

  const reservationIds = candidateReservations.map((r) => r.id);
  const placeholders = reservationIds.map(() => '?').join(',');

  // Identify, BEFORE the update, the set of reservations that actually carry at
  // least one non-forced extra line — those are the rows the count should report.
  const reservationsWithWork = new Set();
  for (const table of EXTRAS_TABLES) {
    const rows = database.prepare(
      `SELECT DISTINCT reservationId FROM ${table}
        WHERE reservationId IN (${placeholders})
          AND COALESCE(inComplement, 0) = 0`
    ).all(...reservationIds);
    for (const row of rows) reservationsWithWork.add(row.reservationId);
  }

  if (reservationsWithWork.size === 0) {
    return { affectedReservations: 0, affectedLines: 0 };
  }

  // Warn-pass: surface reservations whose extras carried captured acompte contribs
  // before the migration nulled them. The migration itself proceeds either way.
  for (const table of EXTRAS_TABLES) {
    const rows = database.prepare(
      `SELECT DISTINCT reservationId FROM ${table}
        WHERE reservationId IN (${placeholders})
          AND COALESCE(inComplement, 0) = 0
          AND acompteContribTtc IS NOT NULL`
    ).all(...reservationIds);
    for (const row of rows) {
      // eslint-disable-next-line no-console
      console.warn(
        `[migration:force-extras-complement-on-platform] reservation #${row.reservationId}: ` +
        `had captured acompte contribs on extras in ${table}; nulled — review the export if needed`
      );
    }
  }

  // The bulk update. `COALESCE(inComplement, 0) = 0` guard makes it idempotent.
  let affectedLines = 0;
  for (const table of EXTRAS_TABLES) {
    const result = database.prepare(
      `UPDATE ${table}
          SET inComplement = 1,
              acompteContribTtc = NULL,
              soldeContribTtc = NULL
        WHERE reservationId IN (${placeholders})
          AND COALESCE(inComplement, 0) = 0`
    ).run(...reservationIds);
    affectedLines += result.changes;
  }

  return {
    affectedReservations: reservationsWithWork.size,
    affectedLines,
  };
}

module.exports = { runForceExtrasComplementOnPlatform };
