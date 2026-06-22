/**
 * Durable de-duplication of `platforms` rows that share a canonical name (slug).
 *
 * Bug it fixes (2026-06-22): the platforms catalogue could accumulate two rows for the same platform
 * differing only by case — e.g. « Lodgify » (id 3) and « lodgify » (id 28780) — because the boot
 * seeding (`INSERT OR IGNORE … SELECT DISTINCT platformLabel/platform …`) is case-sensitive and new
 * lowercase variants appear after the one-shot `platform_names_normalized_v1` migration already ran.
 * With duplicates present, the per-platform tourist-tax write (`setTouristTaxCollection`) updates one
 * row while the per-property read (`listForProperty`, last-wins map) reflects the other → the operator's
 * change silently "doesn't apply".
 *
 * Unlike the one-shot `normalizePlatformNamesMigration`, this runs on EVERY boot (idempotent: a no-op
 * once the table is clean) so duplicates created later are healed automatically. It also MERGES the
 * operator-customised settings (tourist-tax mode, colour, commission account/%/VAT) from the duplicates
 * into the surviving row, so a setting that landed on a soon-to-be-deleted duplicate is preserved.
 *
 * Caller wraps it in `db.transaction()`. Returns `{ mergedCount, renamedCount }`.
 */

const { formatPlatformName } = require('./platformNameFormat');

const OPTIONAL_COLS = [
  'commissionAccountNumber', 'hasVatOnCommission', 'commissionPercent',
  'color', 'collectsTouristTax', 'touristTaxRemittedByPlatform', 'platformTakesDeposit',
];

function tableExists(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name));
}

// A tourist-tax config is "customised" when it differs from the default 'platform' mode (1,1).
function isCustomTax(row) {
  const collects = Number(row.collectsTouristTax);
  const remitted = row.touristTaxRemittedByPlatform === undefined ? 1 : Number(row.touristTaxRemittedByPlatform);
  return collects !== 1 || remitted !== 1;
}

// A scalar setting is "customised" when it differs from its column default (0 / NULL / '').
function isCustomScalar(col, val) {
  if (col === 'color' || col === 'commissionAccountNumber') return val != null && String(val).trim() !== '';
  return Number(val) !== 0; // hasVatOnCommission, commissionPercent
}

function runPlatformSlugDedup(database) {
  const cols = new Set(database.prepare('PRAGMA table_info(platforms)').all().map((c) => c.name));
  const present = OPTIONAL_COLS.filter((c) => cols.has(c));
  const select = `SELECT id, name${present.length ? ', ' + present.join(', ') : ''} FROM platforms`;
  const rows = database.prepare(select).all();

  // Group by canonical name (the slug's canonical UpperCamelCase form).
  const groups = new Map();
  for (const r of rows) {
    const canonical = formatPlatformName(r.name);
    if (canonical == null || canonical === '') continue; // empty/punctuation-only → operator cleans up
    if (!groups.has(canonical)) groups.set(canonical, []);
    groups.get(canonical).push(r);
  }

  const hasIcal = tableExists(database, 'ical_sources');
  const updateIcal = hasIcal ? database.prepare('UPDATE ical_sources SET platformLabel = ? WHERE platformLabel = ?') : null;
  const updateRes = database.prepare('UPDATE reservations SET platform = ? WHERE platform = ?');
  const deletePlatform = database.prepare('DELETE FROM platforms WHERE id = ?');

  let mergedCount = 0;
  let renamedCount = 0;

  for (const [canonical, list] of groups.entries()) {
    if (list.length === 1 && list[0].name === canonical) continue; // already clean → no-op

    // Winner: the row already named canonically, else the lowest id (deterministic + stable).
    const sorted = [...list].sort((a, b) => {
      const aCanon = a.name === canonical ? 0 : 1;
      const bCanon = b.name === canonical ? 0 : 1;
      return (aCanon - bCanon) || (a.id - b.id);
    });
    const winner = sorted[0];
    const losers = sorted.slice(1);

    // Merge customised settings into the winner where it sits at default. Among several customised
    // duplicates, the highest id (most recently inserted) wins — closest to the operator's latest intent.
    const finalVals = {};
    if (present.includes('collectsTouristTax')) {
      let src = winner;
      if (!isCustomTax(winner)) {
        const donor = [...losers].filter(isCustomTax).sort((a, b) => b.id - a.id)[0];
        if (donor) src = donor;
      }
      finalVals.collectsTouristTax = src.collectsTouristTax;
      if (present.includes('touristTaxRemittedByPlatform')) finalVals.touristTaxRemittedByPlatform = src.touristTaxRemittedByPlatform;
    }
    for (const col of ['commissionAccountNumber', 'hasVatOnCommission', 'commissionPercent', 'color', 'platformTakesDeposit']) {
      if (!present.includes(col)) continue;
      if (isCustomScalar(col, winner[col])) { finalVals[col] = winner[col]; continue; }
      const donor = [...losers].filter((l) => isCustomScalar(col, l[col])).sort((a, b) => b.id - a.id)[0];
      finalVals[col] = donor ? donor[col] : winner[col];
    }

    // Re-point name-based references (iCal sources + reservations) to the canonical name, drop losers.
    for (const loser of losers) {
      if (updateIcal) updateIcal.run(canonical, loser.name);
      updateRes.run(canonical, loser.name);
      deletePlatform.run(loser.id);
      mergedCount += 1;
    }
    if (winner.name !== canonical) {
      if (updateIcal) updateIcal.run(canonical, winner.name);
      updateRes.run(canonical, winner.name);
      renamedCount += 1;
    }

    // Apply the canonical name + merged settings to the surviving row.
    const setParts = ['name = @name'];
    const params = { id: winner.id, name: canonical };
    for (const [k, v] of Object.entries(finalVals)) { setParts.push(`${k} = @${k}`); params[k] = v; }
    database.prepare(`UPDATE platforms SET ${setParts.join(', ')} WHERE id = @id`).run(params);
  }

  return { mergedCount, renamedCount };
}

module.exports = { runPlatformSlugDedup };
