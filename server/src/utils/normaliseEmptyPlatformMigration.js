/**
 * One-shot data hygiene migration: every reservation must carry an explicit `platform`
 * value — either a real platform name (Airbnb, GitesDeFrance, etc.) or the canonical
 * 'direct' for own-channel bookings. NULL / '' / whitespace-only is normalised to
 * 'direct' here so the rest of the codebase can trust the column.
 *
 * Spec: specs/bed-config-in-linen-card.md §10 hotfix follow-up #4 (2026-06-05).
 *
 * Pairs with the controller-level coercion in `reservationsController` — that one catches
 * any future write that tries to persist an empty value (e.g. an iCal import path, a
 * third-party caller); this migration sweeps the legacy rows that pre-date the invariant.
 *
 * Gated by the caller via `migrations.platform_empty_to_direct_v1`. The caller wraps the
 * call in `db.transaction()` so a partial run rolls back cleanly.
 */

function runNormaliseEmptyPlatformMigration(database) {
  const result = database.prepare(`
    UPDATE reservations
       SET platform = 'direct'
     WHERE platform IS NULL
        OR TRIM(platform) = ''
  `).run();
  return { normalisedCount: result.changes };
}

module.exports = { runNormaliseEmptyPlatformMigration };
