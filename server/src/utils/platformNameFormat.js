/**
 * Platform name canonical form — `formatPlatformName(input)`.
 *
 * Reduces a free-form platform string to a single canonical UpperCamelCase shape so the
 * `platforms` UNIQUE(name) constraint deduplicates case-different inputs (`gitedefrance` and
 * `Gitedefrance` both → `Gitedefrance`). Applied at every write site that lands a value in
 * `ical_sources.platformLabel`, `reservations.platform`, or `platforms.name`.
 *
 * Algorithm (spec: specs/normalize-platform-names.md §3.1):
 *   1. `null` / `undefined` → `null` (= "no platform on this write, leave the column alone").
 *   2. The `direct` enum value (case-insensitive) is preserved as lowercase `'direct'` — strict
 *      equality checks against `'direct'` in the codebase (accountingExport, accountingModel,
 *      SQL filters) keep working.
 *   3. NFD-strip diacritics (`Gîtes` → `Gites`).
 *   4. Split on every non-alphanumeric character (whitespace, hyphen, underscore, punctuation).
 *      Drop empty segments.
 *   5. Each segment: first letter uppercase, remaining letters lowercase.
 *   6. Concatenate without separator.
 *   7. Empty result → `''` (caller decides whether to ignore or 400).
 *
 * The formatter is a mechanical case-normalizer, NOT a spell-checker — typos like `logify`
 * survive as `Logify`. Operator cleans these up manually from the dedicated config page.
 */

function formatPlatformName(input) {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return '';
  // `direct` is enum-like — preserve lowercase so the codebase's strict equality checks against
  // 'direct' (accountingExport.js, accountingModel.js, SQL filters in database.js) keep working.
  if (raw.toLowerCase() === 'direct') return 'direct';
  // NFD-strip diacritics: `Gîtes` → `Gites`, `Hôtel` → `Hotel`.
  const stripped = raw.normalize('NFD').replace(/\p{M}/gu, '');
  // Split on:
  //   - every non-alphanumeric character (whitespace, hyphen, underscore, punctuation), AND
  //   - every camelCase boundary (lowercase/digit → Uppercase), so the formatter is idempotent
  //     on its own output: `GitesDeFrance` re-splits back into `[Gites, De, France]`. Without
  //     this, the second pass would collapse to `Gitesdefrance` (word-boundary info lost).
  const withBoundaries = stripped.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const segments = withBoundaries.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (segments.length === 0) return '';
  return segments
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase())
    .join('');
}

/**
 * Own-channel platforms — `isDirectChannel(platform)`.
 *
 * A booking is « direct » in the commercial sense when the guest relationship is the operator's own,
 * with no OTA in between: `direct` (created by hand in GuestFlow), plus every platform the operator
 * marked « Compté comme vente directe » — the booking engine of the operator's own website, whose fee
 * is not a marketplace commission (specs/plugins-phase-p-productisation.md rule 19).
 *
 * Used by the welcome pack (specs/tariff-recipes/spec.md §3.9 rule 53) and every read that tells a
 * direct booking from a platform one. Never compare a platform to `'direct'` by hand.
 */
let directChannels = new Set(['direct']);

const channelKey = (platform) => String(platform ?? 'direct').trim().toLowerCase() || 'direct';

function isDirectChannel(platform) {
  return directChannels.has(channelKey(platform));
}

/** `direct` always, plus the platforms named here (specs/plugins-phase-p-productisation.md rule 19). */
function setDirectChannels(names = []) {
  directChannels = new Set(['direct', ...names.map(channelKey)]);
}

/** Re-reads `platforms.countsAsDirect`: at boot and after every platform save. */
function refreshDirectChannels(database) {
  let names = [];
  try {
    names = database.prepare('SELECT name FROM platforms WHERE countsAsDirect = 1').all().map((r) => r.name);
  } catch {
    names = [];
  }
  setDirectChannels(names);
}

/**
 * `is_direct_channel(platform)` for the SQL reads that filter on it, so they follow the same set as
 * `isDirectChannel` instead of a list frozen when the module loaded. Idempotent per connection.
 */
function registerDirectChannelSql(database) {
  if (!database || typeof database.function !== 'function' || database.__directChannelSql) return;
  database.function('is_direct_channel', { deterministic: false }, (platform) => (isDirectChannel(platform) ? 1 : 0));
  Object.defineProperty(database, '__directChannelSql', { value: true });
}

module.exports = { formatPlatformName, isDirectChannel, setDirectChannels, refreshDirectChannels, registerDirectChannelSql };
