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
 * with no OTA in between. That covers two recorded platform values, not one:
 *   - `direct`   — created by hand in GuestFlow (phone, email, walk-in).
 *   - `Lodgify`  — the booking engine ON the operator's own website. Commercially a direct booking;
 *                  its 5 % is an engine fee, not a marketplace commission.
 *
 * Used by the welcome pack (specs/tariff-recipes/spec.md §3.9 rule 53). A strict equality against
 * `'direct'` would miss the majority of real direct bookings, which come through Lodgify.
 * A third own channel is a one-line addition here rather than a new condition somewhere else.
 */
const DIRECT_CHANNELS = new Set(['direct', 'lodgify']);

function isDirectChannel(platform) {
  return DIRECT_CHANNELS.has(String(platform ?? 'direct').trim().toLowerCase() || 'direct');
}

module.exports = { formatPlatformName, isDirectChannel, DIRECT_CHANNELS };
