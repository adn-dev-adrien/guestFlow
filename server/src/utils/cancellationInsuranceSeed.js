/**
 * Cancellation-insurance option seeder (specs/cancellation-insurance.md §3.2 rules 11-15).
 *
 * Structural boot-time seed with the same contract as `cateringSeed.js`: idempotent,
 * non-destructive, re-run on every server start, keyed on `options.seedKey` so the operator can
 * rename, re-price and re-scope the article without the next boot inserting a duplicate beside it.
 *
 * What the seeded row carries:
 *   - `isCancellationInsurance = 1` → the ONLY discriminator the public API and the website key on
 *     (never a title match), and what makes the option undeletable in the Options screen.
 *   - `priceType = 'per_night'`, `price = 0` → **unconfigured**. An insurance at 0 is returned
 *     nowhere on the public side, so the booking funnel stays exactly as it is until Adrien sets a
 *     tariff. He can switch the type afterwards (flat amount, % of the stay…) — the flag is
 *     type-agnostic.
 *   - links to every property, re-applied on every boot so a property created later gets it too.
 *
 * Adoption path: an option whose title matches a known alias but carries no `seedKey` (a row the
 * operator created by hand) is adopted — flag + seedKey set, price/scope/wording untouched.
 *
 * Exclusivity repair: a hand-edited database holding several flagged rows is collapsed onto the
 * lowest id, with a single warning line (rule 12).
 *
 * Retype path (rule 13bis): a row seeded before the per-night default, still at 0 and still a
 * `percent_of_stay`, is switched to `per_night`. Guarded on « no tariff anywhere » — a base price
 * or a per-property override means the operator priced a PERCENTAGE, and 4 % must never silently
 * become 4 € a night.
 *
 * Returns an `{ action, linked }` tag for the unit tests and the boot log.
 */

const SEED_KEY = 'cancellation_insurance';

const SEED_DEFINITION = Object.freeze({
  seedKey: SEED_KEY,
  title: 'Assurance annulation',
  titleEn: 'Cancellation insurance',
  description: "Garantie annulation : en cas d'annulation de votre séjour pour un motif couvert, les sommes déjà versées vous sont remboursées.",
});

// Titles adopted instead of duplicated — the wordings an operator would plausibly have typed
// before this feature shipped.
const KNOWN_TITLE_ALIASES = Object.freeze([
  'assurance annulation',
  'assurance annulation de séjour',
  'assurance annulation de sejour',
  'garantie annulation',
]);

function ensureCancellationInsuranceOption(database, { logger = console } = {}) {
  try {
    const cols = database.prepare('PRAGMA table_info(options)').all().map((c) => c.name);
    if (!cols.includes('seedKey') || !cols.includes('isCancellationInsurance')) {
      // Schema not migrated yet — the next boot, after the columns are added, will seed.
      return { action: 'skipped-schema' };
    }
    const hasTitleEn = cols.includes('titleEn');

    const findBySeedKey = database.prepare('SELECT id FROM options WHERE seedKey = ? LIMIT 1');
    const findFlagged = database.prepare('SELECT id FROM options WHERE isCancellationInsurance = 1 ORDER BY id');
    // Adoption lookup — deliberately excludes rows that already carry a seedKey so two seeds can
    // never fight over the same row.
    const aliasPlaceholders = KNOWN_TITLE_ALIASES.map(() => '?').join(', ');
    const findByTitle = database.prepare(`
      SELECT id FROM options
       WHERE LOWER(TRIM(title)) IN (${aliasPlaceholders}) AND (seedKey IS NULL OR seedKey = '')
       ORDER BY id
       LIMIT 1
    `);
    const adopt = database.prepare(
      'UPDATE options SET seedKey = ?, isCancellationInsurance = 1 WHERE id = ?',
    );
    const insert = database.prepare(hasTitleEn
      ? `INSERT INTO options (
           title, titleEn, description, priceType, price, optionProgressiveTiers,
           autoEnabled, autoPricingMode, countsAsBedLinen, countsAsBathroomLinen,
           displayToClient, seedKey, isCancellationInsurance
         ) VALUES (?, ?, ?, 'per_night', 0, '[]', 0, 'fixed', 0, 0, 1, ?, 1)`
      : `INSERT INTO options (
           title, description, priceType, price, optionProgressiveTiers,
           autoEnabled, autoPricingMode, countsAsBedLinen, countsAsBathroomLinen,
           displayToClient, seedKey, isCancellationInsurance
         ) VALUES (?, ?, 'per_night', 0, '[]', 0, 'fixed', 0, 0, 1, ?, 1)`);
    const link = database.prepare(
      'INSERT OR IGNORE INTO property_options (propertyId, optionId) VALUES (?, ?)',
    );
    const unflag = database.prepare('UPDATE options SET isCancellationInsurance = 0 WHERE id = ?');
    // Retype (rule 13bis). `price <= 0` AND no per-property override = the operator never priced
    // this insurance, so nothing of his is rewritten by moving it to the per-night default.
    const hasPropertyPrices = database
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'property_option_prices'")
      .get().n > 0;
    const countPropertyPrices = hasPropertyPrices
      ? database.prepare('SELECT COUNT(*) AS n FROM property_option_prices WHERE optionId = ? AND price > 0')
      : null;
    const readPricing = database.prepare('SELECT priceType, price FROM options WHERE id = ?');
    const retype = database.prepare("UPDATE options SET priceType = 'per_night' WHERE id = ?");

    let action = 'skipped-already-seeded';
    let linked = 0;
    let deduped = 0;
    let retyped = false;

    const tx = database.transaction(() => {
      // NOTE: no `archivedAt IS NULL` filter — an archived insurance counts as present, so
      // archiving stays the permanent way to retire it.
      let row = findBySeedKey.get(SEED_KEY);
      if (!row) {
        const candidate = findByTitle.get(...KNOWN_TITLE_ALIASES);
        if (candidate) {
          adopt.run(SEED_KEY, candidate.id);
          action = 'promoted-adopted';
          row = candidate;
        }
      }
      if (!row) {
        const res = hasTitleEn
          ? insert.run(SEED_DEFINITION.title, SEED_DEFINITION.titleEn, SEED_DEFINITION.description, SEED_KEY)
          : insert.run(SEED_DEFINITION.title, SEED_DEFINITION.description, SEED_KEY);
        action = 'seeded';
        row = { id: Number(res.lastInsertRowid) };
      }

      // Runs on every boot, not just on insert: a property created after the first seed run must
      // still be offered the insurance.
      const propertyIds = database.prepare('SELECT id FROM properties').all().map((r) => r.id);
      for (const propertyId of propertyIds) {
        linked += link.run(propertyId, row.id).changes;
      }

      const pricing = readPricing.get(row.id) || {};
      const pricedPerProperty = countPropertyPrices ? countPropertyPrices.get(row.id).n > 0 : false;
      if (String(pricing.priceType) === 'percent_of_stay' && Number(pricing.price || 0) <= 0 && !pricedPerProperty) {
        retype.run(row.id);
        retyped = true;
      }

      // Exclusivity (rule 12) — the lowest flagged id wins, every other flagged row is cleared.
      const flagged = findFlagged.all().map((r) => Number(r.id));
      if (flagged.length > 1) {
        const keep = flagged[0];
        for (const id of flagged) {
          if (id !== keep) { unflag.run(id); deduped += 1; }
        }
      }
    });
    tx();

    if (action !== 'skipped-already-seeded') {
      logger.log(`[seed:cancellation-insurance] ${action} (linked ${linked} property row(s))`);
    }
    if (retyped) {
      logger.log('[seed:cancellation-insurance] unpriced insurance switched from « % du séjour » to « par nuit »');
    }
    if (deduped > 0) {
      logger.warn(`[seed:cancellation-insurance] several options carried the flag — cleared ${deduped}, kept the lowest id`);
    }
    return { action, linked, deduped, retyped };
  } catch (error) {
    console.error(`[seed:cancellation-insurance] failed: ${error.message}`);
    return { action: 'error', error: error.message };
  }
}

module.exports = {
  ensureCancellationInsuranceOption,
  SEED_DEFINITION,
  SEED_KEY,
  KNOWN_TITLE_ALIASES,
};
