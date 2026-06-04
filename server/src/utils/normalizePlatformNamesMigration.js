/**
 * One-shot data migration: normalize every platform name across the 3 tables that hold them
 * (`platforms.name`, `ical_sources.platformLabel`, `reservations.platform`) to the canonical
 * UpperCamelCase form computed by `utils/platformNameFormat.formatPlatformName`.
 *
 * Spec: specs/normalize-platform-names.md §3.3.
 *
 * Gated by the caller via `migrations.platform_names_normalized_v1`. This function does NOT
 * check or insert into the `migrations` table — it just runs the work. The boot path in
 * `database.js` is responsible for idempotency.
 *
 * The function is wrapped in `db.transaction()` by the caller so a partial run rolls back
 * cleanly on error.
 */

const { formatPlatformName } = require('./platformNameFormat');

function runPlatformNamesNormalization(database) {
  const updateIcalLabel = database.prepare('UPDATE ical_sources SET platformLabel = ? WHERE platformLabel = ?');
  const updateResPlatform = database.prepare('UPDATE reservations SET platform = ? WHERE platform = ?');
  const deletePlatform = database.prepare('DELETE FROM platforms WHERE id = ?');
  const renamePlatform = database.prepare('UPDATE platforms SET name = ? WHERE id = ?');

  // Group every `platforms` row by canonical name.
  const allPlatforms = database.prepare('SELECT id, name, commissionAccountNumber, hasVatOnCommission FROM platforms').all();
  const groups = new Map();
  for (const row of allPlatforms) {
    const canonical = formatPlatformName(row.name);
    if (canonical == null || canonical === '') continue; // empty/punctuation-only: operator cleans up manually
    if (!groups.has(canonical)) groups.set(canonical, []);
    groups.get(canonical).push(row);
  }

  let mergedCount = 0;
  let renamedCount = 0;

  for (const [canonical, rows] of groups.entries()) {
    // Conflict resolution: winner = row with non-NULL commissionAccountNumber (operator-configured
    // wins over default), tiebreak by lowest id.
    const sorted = [...rows].sort((a, b) => {
      const aHas = a.commissionAccountNumber != null ? 0 : 1;
      const bHas = b.commissionAccountNumber != null ? 0 : 1;
      if (aHas !== bHas) return aHas - bHas;
      return a.id - b.id;
    });
    const winner = sorted[0];
    const losers = sorted.slice(1);

    // Step B — merge: for each loser, update FK-by-name references to the winner's current
    // name, then delete the loser's `platforms` row.
    for (const loser of losers) {
      updateIcalLabel.run(winner.name, loser.name);
      updateResPlatform.run(winner.name, loser.name);
      deletePlatform.run(loser.id);
      mergedCount += 1;
    }

    // Step C — rename: cascade the canonical name through the 3 tables when the winner's
    // current name isn't already canonical.
    if (winner.name !== canonical) {
      updateIcalLabel.run(canonical, winner.name);
      updateResPlatform.run(canonical, winner.name);
      renamePlatform.run(canonical, winner.id);
      renamedCount += 1;
    }
  }

  // Step D — defensive pass: an `ical_sources.platformLabel` or `reservations.platform` value
  // might not have a matching `platforms` row at migration time (e.g. an iCal source was
  // created before the corresponding `platforms` seed). Normalize those too.
  const allIcalLabels = database.prepare("SELECT DISTINCT platformLabel FROM ical_sources WHERE platformLabel IS NOT NULL AND platformLabel != ''").all();
  for (const { platformLabel } of allIcalLabels) {
    const canonical = formatPlatformName(platformLabel);
    if (canonical && canonical !== platformLabel) updateIcalLabel.run(canonical, platformLabel);
  }
  const allReservationPlatforms = database.prepare("SELECT DISTINCT platform FROM reservations WHERE platform IS NOT NULL AND platform != ''").all();
  for (const { platform } of allReservationPlatforms) {
    const canonical = formatPlatformName(platform);
    if (canonical && canonical !== platform) updateResPlatform.run(canonical, platform);
  }

  return { mergedCount, renamedCount };
}

module.exports = { runPlatformNamesNormalization };
