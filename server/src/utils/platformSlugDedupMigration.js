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
 * A second pass then normalises every remaining name-based reference (`reservations.platform`,
 * `ical_sources.platformLabel`) to its canonical form, even when no `platforms` row carries the
 * drifted spelling — the case the first pass structurally cannot see.
 *
 * Caller wraps it in `db.transaction()`. Returns `{ mergedCount, renamedCount, normalisedRefs }`.
 */

const { formatPlatformName } = require('./platformNameFormat');
const { DEFAULT_PAYOUT_DUE_DAYS } = require('./platformPayout');

const OPTIONAL_COLS = [
  'commissionAccountNumber', 'hasVatOnCommission', 'commissionPercent',
  'color', 'collectsTouristTax', 'touristTaxRemittedByPlatform', 'platformTakesDeposit',
  'payoutDueDays', 'countsAsDirect', 'forbidsGuestChores',
];

// Columns merged by `isCustomScalar`, in the order they are applied to the surviving row.
const MERGED_SCALAR_COLS = [
  'commissionAccountNumber', 'hasVatOnCommission', 'commissionPercent', 'color',
  'platformTakesDeposit', 'payoutDueDays',
  // Operator switches (specs/plugins-phase-p-productisation.md rule 19, specs/airbnb-no-checkout-chores.md
  // rule 8): ticked on any duplicate means ticked on the survivor.
  'countsAsDirect', 'forbidsGuestChores',
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
  // specs/platform-payout-due-date.md — this one's default is 10, not 0: a platform genuinely set to
  // 0 days ("pays on the departure day") is a customisation and must survive a dedup.
  if (col === 'payoutDueDays') return val != null && Number(val) !== DEFAULT_PAYOUT_DUE_DAYS;
  return Number(val) !== 0; // hasVatOnCommission, commissionPercent, platformTakesDeposit, the switches
}

const slug = (v) => String(v || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function runPlatformSlugDedup(database) {
  const cols = new Set(database.prepare('PRAGMA table_info(platforms)').all().map((c) => c.name));
  const present = OPTIONAL_COLS.filter((c) => cols.has(c));
  const select = `SELECT id, name${present.length ? ', ' + present.join(', ') : ''} FROM platforms`;
  const rows = database.prepare(select).all();

  // Group by compact slug — case, accents and separators ignored (specs/normalize-platform-names.md
  // rule 23). Grouping by `formatPlatformName` kept `AirbnbTente` and `Airbnbtente` apart: both are
  // already canonical, yet they are one platform, and the second one carried no commission.
  const bySlug = new Map();
  for (const r of rows) {
    const canonical = formatPlatformName(r.name);
    if (canonical == null || canonical === '') continue; // empty/punctuation-only → operator cleans up
    const key = slug(r.name);
    if (!bySlug.has(key)) bySlug.set(key, []);
    bySlug.get(key).push(r);
  }

  const hasIcal = tableExists(database, 'ical_sources');
  const updateIcal = hasIcal ? database.prepare('UPDATE ical_sources SET platformLabel = ? WHERE platformLabel = ?') : null;
  const updateRes = database.prepare('UPDATE reservations SET platform = ? WHERE platform = ?');
  // Display data of a cancelled stay's indemnity: follows the merge like the stays.
  const hasCompensations = tableExists(database, 'cancellation_compensations')
    && database.prepare('PRAGMA table_info(cancellation_compensations)').all().some((c) => c.name === 'platform');
  const updateComp = hasCompensations ? database.prepare('UPDATE cancellation_compensations SET platform = ? WHERE platform = ?') : null;
  const deletePlatform = database.prepare('DELETE FROM platforms WHERE id = ?');
  const repointRefs = (to, from) => {
    if (updateIcal) updateIcal.run(to, from);
    updateRes.run(to, from);
    if (updateComp) updateComp.run(to, from);
  };

  // Rule 23 (amended after the PR #798 review) — the survivor is the most-referenced row (stays + iCal
  // sources), then the lowest id. Other code matches platform names exactly (the Qonto reconciliation
  // among them), so a stray `AirBnb` must never rename the established `Airbnb`. « Most camel-case
  // segments » only breaks a tie between rows nobody references (`GitesDeFrance` over `Gitesdefrance`).
  const countRes = database.prepare('SELECT COUNT(*) c FROM reservations WHERE platform = ?');
  const countIcal = hasIcal ? database.prepare('SELECT COUNT(*) c FROM ical_sources WHERE platformLabel = ?') : null;
  const refsOf = (name) => countRes.get(name).c + (countIcal ? countIcal.get(name).c : 0);
  const segmentsOf = (name) => (String(name).normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean).length);
  const groups = [];
  for (const list of bySlug.values()) {
    const ranked = list.map((r) => ({ row: r, refs: refsOf(r.name) })).sort((a, b) => (b.refs - a.refs)
      || (a.refs === 0 && b.refs === 0 ? segmentsOf(b.row.name) - segmentsOf(a.row.name) : 0)
      || (a.row.id - b.row.id));
    const sorted = ranked.map((x) => x.row);
    groups.push({ canonical: formatPlatformName(sorted[0].name), sorted });
  }

  let mergedCount = 0;
  let renamedCount = 0;

  for (const { canonical, sorted } of groups) {
    if (sorted.length === 1 && sorted[0].name === canonical) continue; // already clean → no-op
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
    for (const col of MERGED_SCALAR_COLS) {
      if (!present.includes(col)) continue;
      if (isCustomScalar(col, winner[col])) { finalVals[col] = winner[col]; continue; }
      const donor = [...losers].filter((l) => isCustomScalar(col, l[col])).sort((a, b) => b.id - a.id)[0];
      finalVals[col] = donor ? donor[col] : winner[col];
    }

    // Re-point name-based references (iCal sources + reservations) to the canonical name, drop losers.
    for (const loser of losers) {
      repointRefs(canonical, loser.name);
      deletePlatform.run(loser.id);
      mergedCount += 1;
    }
    if (winner.name !== canonical) {
      repointRefs(canonical, winner.name);
      renamedCount += 1;
    }

    // Apply the canonical name + merged settings to the surviving row.
    const setParts = ['name = @name'];
    const params = { id: winner.id, name: canonical };
    for (const [k, v] of Object.entries(finalVals)) { setParts.push(`${k} = @${k}`); params[k] = v; }
    database.prepare(`UPDATE platforms SET ${setParts.join(', ')} WHERE id = @id`).run(params);
  }

  // Step 2 — normalise the NAME-BASED references that no `platforms` row points at any more.
  // The loop above only re-points a value that exactly equals a duplicate row's name; a
  // `reservations.platform` holding a slug (`abracadaroom`, `gites-de-france` — what the iCal sync
  // used to write) has no matching row once the catalogue is clean, so it used to survive forever
  // and showed the same platform twice in the calendar legend. Normalising every distinct value to
  // its canonical form is the invariant, stated once and re-asserted at every boot.
  //
  // The target name is the CATALOGUE's spelling when a row shares the value's slug, so a reference
  // never gets rewritten into a name no `platforms` row carries: the feed slug `gites-de-france`
  // becomes the catalogue's `GitesDeFrance` rather than a second spelling of it. With no matching
  // row, the canonical form is the target and the boot seeding creates the row.
  const catalogue = new Map();
  for (const r of database.prepare('SELECT name FROM platforms').all()) {
    const key = slug(r.name);
    if (key && !catalogue.has(key)) catalogue.set(key, r.name);
  }
  const renameRefs = (table, column) => {
    let changed = 0;
    const values = database
      .prepare(`SELECT DISTINCT ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`)
      .all()
      .map((r) => r.v);
    const update = database.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`);
    for (const value of values) {
      const canonical = formatPlatformName(value);
      if (!canonical) continue;
      const target = catalogue.get(slug(value)) || canonical;
      if (target === value) continue;
      changed += update.run(target, value).changes;
    }
    return changed;
  };
  let normalisedRefs = renameRefs('reservations', 'platform');
  if (hasIcal) normalisedRefs += renameRefs('ical_sources', 'platformLabel');

  return { mergedCount, renamedCount, normalisedRefs };
}

module.exports = { runPlatformSlugDedup };
