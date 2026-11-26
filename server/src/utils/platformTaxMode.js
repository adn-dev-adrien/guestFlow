/**
 * The tourist-tax mode of a platform, as the pricing engine reads it (specs/per-platform-tourist-tax-three-way.md).
 *
 * `resolveGlobalPlatformTaxRow(db, platform)` is the engine's resolver, kept here so `database.js` (the one-pass migration of
 * specs/platform-host-statement-and-commission-vat.md rule 4) and every reader of the mode name the same platform the engine does;
 * `touristTaxModeOf(db, platform)` turns its row into `'platform' | 'platform_reversed' | 'owner'`.
 * Pure over the database it is given: it requires nothing that opens one.
 */
const { isNamedChannel } = require('./saleChannel');

// GLOBAL per-platform tourist-tax mode resolver (specs/per-platform-tourist-tax-three-way.md). The
// mode lives on the `platforms` table (one row per platform, shared across all properties), like the
// calendar colour. Returns the `{ collectsTouristTax, touristTaxRemittedByPlatform }` row or null.
//
// A reservation's `platform` string is written two ways: manual reservations store the concatenated
// label (= `platforms.name`), iCal imports store the hyphenated `source.platformKey`. So we resolve
// in two steps: (1) direct match on `platforms.name`; (2) bridge through `ical_sources` (key OR label)
// to recover the canonical `platformLabel`, then match `platforms.name`. The `propertyId` argument is
// kept for call-site compatibility but ignored — the mode is global.
function resolveGlobalPlatformTaxRow(db, platform) {
  if (!isNamedChannel(platform)) return null;
  const needle = String(platform).toLowerCase();
  try {
    let row = db.prepare(
      'SELECT collectsTouristTax AS c, touristTaxRemittedByPlatform AS r FROM platforms WHERE lower(name) = ? LIMIT 1'
    ).get(needle);
    if (row) return row;
    // Bridge: an iCal-imported reservation stores the hyphenated key; map it to the canonical label
    // via any ical_sources row, then read the global mode for that label.
    row = db.prepare(`
      SELECT pl.collectsTouristTax AS c, pl.touristTaxRemittedByPlatform AS r
      FROM ical_sources s JOIN platforms pl ON lower(pl.name) = lower(s.platformLabel)
      WHERE lower(s.platformKey) = ? OR lower(s.platformLabel) = ? LIMIT 1
    `).get(needle, needle);
    return row || null;
  } catch (_) {
    // `platforms`/`ical_sources` table or the tax columns may be absent in minimal test DBs.
    return null;
  }
}


// `direct` is collected and remitted by us (`owner`); a named platform with no row is read as `platform`, the engine's legacy default.
function touristTaxModeOf(db, platform) {
  if (!isNamedChannel(platform)) return 'owner';
  const row = resolveGlobalPlatformTaxRow(db, platform);
  if (!row) return 'platform';
  if (Number(row.c) === 0) return 'owner';
  return Number(row.r) === 0 ? 'platform_reversed' : 'platform';
}

module.exports = { resolveGlobalPlatformTaxRow, touristTaxModeOf };
