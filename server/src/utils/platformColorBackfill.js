/**
 * One-time backfill of the GLOBAL `platforms.color` from any operator-customised per-source
 * `ical_sources.platformColor` (specs/platforms-and-ical-rework.md §5).
 *
 * A colour counts as custom only when it differs from the grey default AND from the platform's built-in
 * brand colour — the current one or the one before specs/calendar-property-parity.md rule 6: a source row
 * written under the old palette holds the old default, which is not a choice and must not freeze the old
 * palette into `platforms.color`. Only fills rows whose `platforms.color` is still NULL, so it never
 * overwrites a colour chosen later in Paramètres → Plateformes. Idempotent.
 */
const { isBuiltinColor } = require('../constants/platformColors');

const slug = (v) => String(v || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** @returns {string[]} the names of the platforms that received a custom colour */
function backfillPlatformColors(db) {
  const setColor = db.prepare('UPDATE platforms SET color = ? WHERE id = ? AND color IS NULL');
  const latestSourceColor = db.prepare(`
    SELECT platformColor FROM ical_sources
     WHERE lower(platformLabel) = lower(?)
       AND platformColor IS NOT NULL AND trim(platformColor) != ''
     ORDER BY updatedAt DESC, id DESC LIMIT 1
  `);
  const filled = [];
  for (const platform of db.prepare('SELECT id, name FROM platforms WHERE color IS NULL').all()) {
    const source = latestSourceColor.get(platform.name);
    const custom = source && String(source.platformColor).trim();
    if (custom && !isBuiltinColor(slug(platform.name), custom)) {
      setColor.run(custom, platform.id);
      filled.push(platform.name);
    }
  }
  return filled;
}

module.exports = { backfillPlatformColors };
